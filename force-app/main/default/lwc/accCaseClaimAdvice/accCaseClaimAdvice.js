import { LightningElement, api, wire } from 'lwc';
import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import USER_ID from '@salesforce/user/Id';
import { execute, open } from 'lightning/accApi';
import getConfig from '@salesforce/apex/EmployeeAgentConfigController.getConfig';

import PROFILE_ID_FIELD from '@salesforce/schema/User.ProfileId';
import TYPE_FIELD from '@salesforce/schema/Case.Type';

const SESSION_KEY_PREFIX = 'acc_case_claim_advice_executed_';

export default class AccCaseClaimAdvice extends LightningElement {
    @api recordId;
    
    userProfileId;
    targetProfiles = [];
    isExecuted = false;
    botId;
    caseData;

    get isProfileMatched() {
        if (!this.userProfileId || this.targetProfiles.length === 0) return false;
        const shortUserId = this.userProfileId.substring(0, 15);
        return this.targetProfiles.some(p => p.substring(0, 15) === shortUserId);
    }

    // カスタムメタデータからBotIdとTargetProfilesを取得
    @wire(getConfig, { developerName: 'CaseClaimAdvice' })
    wiredConfig({ error, data }) {
        if (data) {
            this.botId = data.botId;
            if (data.targetProfiles) {
                this.targetProfiles = data.targetProfiles.split(',').map(p => p.trim());
            }
            this.evaluateAdvice();
        } else if (error) {
            console.error('設定の取得に失敗しました', error);
        }
    }

    // 現在のログインユーザーのプロファイルIDを取得
    @wire(getRecord, { recordId: USER_ID, fields: [PROFILE_ID_FIELD] })
    wiredUser({ error, data }) {
        if (data) {
            this.userProfileId = getFieldValue(data, PROFILE_ID_FIELD);
            this.evaluateAdvice();
        } else if (error) {
            console.error('ユーザー情報の取得に失敗しました', error);
        }
    }

    @wire(getRecord, { 
        recordId: '$recordId', 
        fields: [TYPE_FIELD] 
    })
    wiredCase({ error, data }) {
        if (data) {
            this.caseData = data;
            this.evaluateAdvice();
        } else if (error) {
            console.error('ケース情報の取得に失敗しました', error);
        }
    }

    evaluateAdvice() {
        // 全てのデータが揃っているか確認
        if (!this.userProfileId || this.targetProfiles.length === 0 || !this.caseData || !this.botId) {
            return;
        }

        // プロファイルが一致しない場合は処理をスキップ
        if (!this.isProfileMatched) {
            return;
        }

        const caseType = getFieldValue(this.caseData, TYPE_FIELD);

        // 種別が「クレーム」以外なら何もしない
        if (caseType !== 'クレーム' && caseType !== 'Claim') {
            return;
        }

        const sessionKey = SESSION_KEY_PREFIX + this.recordId;
        const hasExecutedInSession = sessionStorage.getItem(sessionKey);

        // このセッションで既に実行済みの場合はスキップ
        if (hasExecutedInSession) {
            this.isExecuted = true;
            return;
        }

        // ACC APIを実行
        this.executeAccAdvice();
    }

    // ACC APIの実行
    async executeAccAdvice() {
        if (!this.botId) {
            console.warn('Bot IDが設定されていないため、ACC APIを実行できません');
            return;
        }

        const promptText = `[AccCaseClaimAdvice]このケースの申告内容を分析し、お客様が最も不満に感じているポイントを特定してください。その上で、社内マニュアルを基に、二次クレームを防ぐためにオペレーターが最初に行うべき謝罪の方向性と、確認すべき必須事項をリストアップしてください。`;
        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        try {
            await open(this.botId);
            await sleep(500);
            await execute(promptText, this.botId);
            
            console.log('ACC APIによるクレーム対応アドバイスが正常に開始されました');
            // 実行済みフラグをセッションストレージに保存
            const sessionKey = SESSION_KEY_PREFIX + this.recordId;
            sessionStorage.setItem(sessionKey, 'true');
            this.isExecuted = true;
        } catch (error) {
            console.error('ACC APIの実行に失敗しました', error);
        }
    }
}
