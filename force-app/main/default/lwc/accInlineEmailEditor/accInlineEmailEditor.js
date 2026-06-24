import { LightningElement, api, wire } from 'lwc';
import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import generateEmailDraft from '@salesforce/apex/AccInlineEmailEditorService.generateEmailDraft';

import CONTACT_EMAIL_FIELD from '@salesforce/schema/Contact.Email';

export default class AccInlineEmailEditor extends LightningElement {
    @api readOnly = false; // 会話ターン終了後の無効化フラグ

    selectedContactId = null;
    isGenerating = false;

    // 内部用の状態変数
    _toAddress = '';
    _subject = '';
    _body = '';

    _recordId = '';

    connectedCallback() {
        // WorkspaceAPIやAgentforceからの引渡しに依存せず、セッションストレージから直接コンテキストIDを取得する
        const recordId = sessionStorage.getItem('Agentforce_EmailEditor_RecordId');
        if (recordId && !this._subject && !this._body && !this.readOnly) {
            this._recordId = recordId;
            this.isGenerating = true;
            
            generateEmailDraft({ recordId: this._recordId })
                .then(result => {
                    if (result) {
                        try {
                            const parsed = JSON.parse(result);
                            this._subject = parsed.subject || '';
                            this._body = parsed.body || '';
                        } catch(e) {
                            this._body = result;
                        }
                        this.notifyChange();
                    }
                })
                .catch(error => {
                    console.error('[accInlineEmailEditor] プロンプトテンプレートの実行に失敗しました', JSON.stringify(error));
                })
                .finally(() => {
                    this.isGenerating = false;
                });
        }
    }

    @wire(getRecord, { recordId: '$selectedContactId', fields: [CONTACT_EMAIL_FIELD] })
    wiredContact({ error, data }) {
        if (data) {
            this._toAddress = getFieldValue(data, CONTACT_EMAIL_FIELD) || '';
            this.notifyChange();
        } else if (error) {
            console.error('[accInlineEmailEditor] 取引先責任者の取得に失敗しました', error);
            this._toAddress = '';
            this.notifyChange();
        }
    }

    // Agentforce から渡されるパラメータを getter / setter で受け取る
    @api 
    get value() {
        return {
            toAddress: this._toAddress,
            subject: this._subject,
            body: this._body,
            recordId: this._recordId
        };
    }
    set value(val) {
        if (val) {
            this._subject = val.subject || this._subject;
            this._body = val.body || this._body;
            // toAddress は UI からのみ設定するため無視
        }
    }

    // 取引先責任者の選択変更をハンドリング
    handleContactChange(event) {
        event.stopPropagation();
        if (this.readOnly) return;
        this.selectedContactId = event.detail.recordId;
        if (!this.selectedContactId) {
            this._toAddress = '';
            this.notifyChange();
        }
    }

    // 件名の変更をハンドリング
    handleSubjectChange(event) {
        event.stopPropagation();
        if (this.readOnly) return;
        this._subject = event.target.value;
        this.notifyChange();
    }

    // 本文の変更をハンドリング
    handleBodyChange(event) {
        event.stopPropagation();
        if (this.readOnly) return;
        this._body = event.target.value;
        this.notifyChange();
    }

    // 変更内容をAgentforceへ通知する共通メソッド
    notifyChange() {
        this.dispatchEvent(
            new CustomEvent('valuechange', {
                detail: {
                    value: {
                        toAddress: this._toAddress,
                        subject: this._subject,
                        body: this._body,
                        recordId: this._recordId
                    }
                }
            })
        );
    }
}
