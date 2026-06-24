import { LightningElement, api, wire } from 'lwc';
import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import USER_ID from '@salesforce/user/Id';
import { execute, open } from 'lightning/accApi';
import getConfig from '@salesforce/apex/EmployeeAgentConfigController.getConfig';

import PROFILE_ID_FIELD from '@salesforce/schema/User.ProfileId';
import STAGE_NAME_FIELD from '@salesforce/schema/Opportunity.StageName';
import LAST_ACTIVITY_DATE_FIELD from '@salesforce/schema/Opportunity.LastActivityDate';

const SESSION_KEY_PREFIX = 'acc_opp_followup_executed_';

export default class AccOpportunityFollowUp extends LightningElement {
    @api recordId;
    
    userProfileId;
    targetProfiles = [];
    isExecuted = false;
    botId;

    opportunityData;

    get isProfileMatched() {
        if (!this.userProfileId || this.targetProfiles.length === 0) return false;
        const shortUserId = this.userProfileId.substring(0, 15);
        return this.targetProfiles.some(p => p.substring(0, 15) === shortUserId);
    }

    // カスタムメタデータからBotIdとTargetProfilesを取得
    @wire(getConfig, { developerName: 'OpportunityFollowUp' })
    wiredConfig({ error, data }) {
        if (data) {
            this.botId = data.botId;
            if (data.targetProfiles) {
                this.targetProfiles = data.targetProfiles.split(',').map(p => p.trim());
            }
            this.evaluateFollowUp();
        } else if (error) {
            console.error('[accOpportunityFollowUp] 設定の取得に失敗しました', error);
        }
    }

    // 現在のログインユーザーのプロファイルIDを取得
    @wire(getRecord, { recordId: USER_ID, fields: [PROFILE_ID_FIELD] })
    wiredUser({ error, data }) {
        if (data) {
            this.userProfileId = getFieldValue(data, PROFILE_ID_FIELD);
            this.evaluateFollowUp();
        } else if (error) {
            console.error('[accOpportunityFollowUp] ユーザー情報の取得に失敗しました', error);
        }
    }

    // 商談の情報を取得
    @wire(getRecord, { 
        recordId: '$recordId', 
        fields: [STAGE_NAME_FIELD, LAST_ACTIVITY_DATE_FIELD] 
    })
    wiredOpportunity({ error, data }) {
        if (data) {
            this.opportunityData = data;
            this.evaluateFollowUp();
        } else if (error) {
            console.error('[accOpportunityFollowUp] 商談情報の取得に失敗しました', error);
        }
    }

    evaluateFollowUp() {
        // 全てのデータが揃っているか確認
        if (!this.userProfileId || this.targetProfiles.length === 0 || !this.opportunityData || !this.botId) {
            return;
        }

        // プロファイルが一致しない場合は処理をスキップ
        if (!this.isProfileMatched) {
            return;
        }

        const sessionKey = SESSION_KEY_PREFIX + this.recordId;
        const hasExecutedInSession = sessionStorage.getItem(sessionKey);

        // このセッションで既に実行済みの場合はスキップ
        if (hasExecutedInSession) {
            this.isExecuted = true;
            return;
        }

        const stageName = getFieldValue(this.opportunityData, STAGE_NAME_FIELD);
        const lastActivityDate = getFieldValue(this.opportunityData, LAST_ACTIVITY_DATE_FIELD);

        // クローズ済みの場合はスキップ
        if (stageName === 'Closed Won' || stageName === 'Closed Lost') {
            return;
        }

        let isStagnant = false;

        // 最終活動日が空（一度も活動がない）場合は無条件で停滞とみなす
        if (!lastActivityDate) {
            isStagnant = true;
        } else {
            // 最終活動日から14日以上経過しているか判定
            const lastActivity = new Date(lastActivityDate);
            const today = new Date();
            const diffTime = Math.abs(today - lastActivity);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
            if (diffDays >= 14) {
                isStagnant = true;
            }
        }

        // 停滞しているとみなされた場合、ACC APIを実行
        if (isStagnant) {
            this.executeAccFollowUp();
        }
    }

    // ACC APIの実行
    async executeAccFollowUp() {
        if (!this.botId) {
            console.warn('[accOpportunityFollowUp] Bot IDが設定されていないため、ACC APIを実行できません');
            return;
        }
        const promptText = `[AccOpportunityFollowUp]インラインメールエディタを開いてください。`;

        // LWCエディタへコンテキストを引き継ぐためにセッションストレージに保存
        sessionStorage.setItem('Agentforce_EmailEditor_RecordId', this.recordId);

        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        try {
            // 1. 必ず対象のボットIDを指定してパネルを開き、エージェントを切り替える
            await open(this.botId);
            
            // 2. パネルの初期化とエージェント切り替えのレンダリングが完了するのを少し待つ
            // （長すぎると遅く感じ、短すぎると真っ白でハングするため 500ms とする）
            await sleep(500);
            
            // 3. 対象エージェントへプロンプトを送信する
            await execute(promptText, this.botId);

            console.log('ACC APIによるフォローアップ提案が正常に開始されました');
            // 実行済みフラグをセッションストレージに保存
            const sessionKey = SESSION_KEY_PREFIX + this.recordId;
            sessionStorage.setItem(sessionKey, 'true');
            this.isExecuted = true;

        } catch (error) {
            console.error('ACC APIの実行に失敗しました', error);
        }
    }
}
