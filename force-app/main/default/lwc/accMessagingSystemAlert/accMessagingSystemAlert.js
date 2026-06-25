import { LightningElement, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { CurrentPageReference } from 'lightning/navigation';
import USER_ID from '@salesforce/user/Id';
import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import { subscribe, unsubscribe, onError } from 'lightning/empApi';
import { execute, open } from 'lightning/accApi';
import { EnclosingUtilityId, open as openUtilityBar, updateUtility } from 'lightning/platformUtilityBarApi';
import getConfig from '@salesforce/apex/EmployeeAgentConfigController.getConfig';

import PROFILE_ID_FIELD from '@salesforce/schema/User.ProfileId';

const SESSION_KEY_PREFIX = 'acc_messaging_system_alert_executed_';

export default class AccMessagingSystemAlert extends LightningElement {
    userProfileId;
    targetProfiles = [];
    
    botId;

    channelName = '/event/System_Alert__e';
    subscription = {};
    isSubscribed = false;

    currentPageRef = null;
    utilityId = null;

    @wire(CurrentPageReference)
    handlePageRef(pageRef) {
        this.currentPageRef = pageRef;
    }

    @wire(EnclosingUtilityId)
    utilityId;

    hasActiveAlert = false;
    currentAlertMessage = '';
    isMessagingSession = false;

    copyIconName = 'utility:copy';

    get copyPasteCommand() {
        return `[AccMessagingSystemAlert]重大なシステム障害が発生しました（内容: ${this.currentAlertMessage}）。あなたが現在対応中のこのメッセージングセッション（MessagingSession）の顧客コンテキストに与える影響を分析し、即座に返信にコピー＆ペーストして使える個別のお詫び文案をテキストとして直接チャットパネルに出力してください。`;
    }

    get isProfileMatched() {
        if (!this.userProfileId || this.targetProfiles.length === 0) return false;
        const shortUserId = this.userProfileId.substring(0, 15);
        return this.targetProfiles.some(p => p.substring(0, 15) === shortUserId);
    }

    // カスタムメタデータからBotIdとTargetProfilesを取得
    @wire(getConfig, { developerName: 'MessagingSystemAlert' })
    wiredConfig({ error, data }) {
        if (data) {
            this.botId = data.botId;
            if (data.targetProfiles) {
                this.targetProfiles = data.targetProfiles.split(',').map(p => p.trim());
            }
            this.checkSubscription();
        } else if (error) {
            console.error('設定の取得に失敗しました', error);
        }
    }

    // 現在のログインユーザーのプロファイルIDを取得
    @wire(getRecord, { recordId: USER_ID, fields: [PROFILE_ID_FIELD] })
    wiredUser({ error, data }) {
        if (data) {
            this.userProfileId = getFieldValue(data, PROFILE_ID_FIELD);
            this.checkSubscription();
        } else if (error) {
            console.error('ユーザー情報の取得に失敗しました', error);
        }
    }

    connectedCallback() {
        this.checkSubscription();
        this.registerErrorListener();
    }

    disconnectedCallback() {
        this.handleUnsubscribe();
    }

    checkSubscription() {
        if (this.isConnected && this.userProfileId && this.botId && this.targetProfiles.length > 0 && !this.isSubscribed) {
            this.isSubscribed = true;
            this.handleSubscribe();
        }
    }

    handleSubscribe() {
        const messageCallback = async (response) => {
            try {
                console.log('New message received: ', JSON.stringify(response));
                
                // プロファイルが合致しない場合はスキップ
                if (!this.isProfileMatched) {
                    return;
                }

                const payload = response.data.payload;
                const severity = payload.Severity__c;
                const message = payload.Message__c || '詳細なし';

                // Severity が High の場合のみ処理
                if (severity === 'High') {
                    const eventId = response.data.event.replayId;
                    
                    let recordId = null;
                    
                    if (this.currentPageRef && this.currentPageRef.attributes) {
                        recordId = this.currentPageRef.attributes.recordId;
                    }
                    
                    // タブがMessagingSessionかどうかを判定 (プレフィックスは '0Mw')
                    let isMessagingSessionTab = recordId && recordId.startsWith('0Mw');
                    
                    this.hasActiveAlert = true;
                    this.currentAlertMessage = message;
                    this.isMessagingSession = isMessagingSessionTab;
                    
                    // ユーティリティバーを強調表示し、自動的に展開する
                    if (this.utilityId) {
                        updateUtility(this.utilityId, { highlighted: true })
                            .catch(err => console.warn('updateUtility failed:', err));
                        openUtilityBar(this.utilityId, { autoFocus: true })
                            .catch(err => console.warn('openUtilityBar failed:', err));
                    } else {
                        console.warn('EnclosingUtilityId が取得できませんでした。');
                    }
                    
                    if (isMessagingSessionTab) {
                        const sessionKey = SESSION_KEY_PREFIX + recordId + '_' + eventId;
                        const hasExecutedInSession = sessionStorage.getItem(sessionKey);

                        // このセッションで既にこのイベント・レコードに対して実行済みの場合はスキップ
                        if (hasExecutedInSession) {
                            return;
                        }

                        // ACC APIを実行 (レコード全体のコンテキストを利用するため個別情報の取得は不要)
                        this.executeAccAlert(message, sessionKey);
                    }
                }
            } catch (globalError) {
                console.error('メッセージコールバック内でエラーが発生しました:', globalError);
            }
        };

        subscribe(this.channelName, -1, messageCallback).then(response => {
            console.log('Subscription request sent to: ', JSON.stringify(response.channel));
            this.subscription = response;
        });
    }

    handleUnsubscribe() {
        if (this.subscription && this.subscription.channel) {
            unsubscribe(this.subscription, response => {
                console.log('unsubscribe() response: ', JSON.stringify(response));
            });
        }
        this.isSubscribed = false;
        this.subscription = {};
    }

    registerErrorListener() {
        onError(error => {
            console.error('Received error from server: ', JSON.stringify(error));
        });
    }
    
    handleCopyCommand() {
        const textarea = document.createElement('textarea');
        textarea.value = this.copyPasteCommand;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);

        // アイコンを一時的にチェックマークに変更
        this.copyIconName = 'utility:check';
        setTimeout(() => {
            this.copyIconName = 'utility:copy';
        }, 2000);
    }

    // ACC APIの実行
    async executeAccAlert(alertMessage, sessionKey) {
        if (!this.botId) {
            console.warn('Bot IDが設定されていないため、ACC APIを実行できません');
            return;
        }

        const promptText = this.copyPasteCommand;

        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        try {
            await open(this.botId);
            await execute(promptText, this.botId);
            
            console.log('ACC APIによる障害アラート対応が正常に開始されました');
            // 実行済みフラグをセッションストレージに保存
            sessionStorage.setItem(sessionKey, 'true');
        } catch (error) {
            console.error('ACC APIの実行に失敗しました', error);
        }
    }
}
