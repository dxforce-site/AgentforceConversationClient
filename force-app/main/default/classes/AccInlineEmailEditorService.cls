// Agentforce LWC Custom Lightning Typeのデータ構造およびアクションを定義するサービスクラス
@JsonAccess(serializable='always' deserializable='always')
public with sharing class AccInlineEmailEditorService {

    // 1. 入力DTO (Custom Lightning Type: accInlineEmailEditorInput)
    @JsonAccess(serializable='always' deserializable='always')
    public class EmailInput {
        @InvocableVariable(label='To Address' description='Recipient email address' required=true)
        @AuraEnabled
        public String toAddress;

        @InvocableVariable(label='Subject' description='Email subject line')
        @AuraEnabled
        public String subject;

        @InvocableVariable(label='Body' description='Email body content')
        @AuraEnabled
        public String body;

        @InvocableVariable(label='Record ID' description='Context record ID passed by Agentforce')
        @AuraEnabled
        public String recordId;
    }

    // 2. 出力DTO
    @JsonAccess(serializable='always' deserializable='always')
    public class EmailOutput {
        @InvocableVariable(label='To Address' description='Recipient email address')
        @AuraEnabled
        public String toAddress;

        @InvocableVariable(label='Subject' description='Email subject line')
        @AuraEnabled
        public String subject;

        @InvocableVariable(label='Body' description='Email body content')
        @AuraEnabled
        public String body;
    }

    // 3. アクション用リクエストラッパー
    @JsonAccess(serializable='always' deserializable='always')
    public class EmailRequest {
        @InvocableVariable(label='Email Data' required=true)
        @AuraEnabled
        public EmailInput emailData;
    }

    // 4. アクション用レスポンスラッパー
    @JsonAccess(serializable='always' deserializable='always')
    public class EmailResponse {
        @InvocableVariable(label='Email Result Data')
        @AuraEnabled
        public EmailOutput email_result_data;
    }

    // 5. アクション本体: エージェントから呼び出される実際のアクションメソッド
    @InvocableMethod(label='Submit Email Form')
    public static List<EmailResponse> submitForm(List<EmailRequest> requests) {
        List<EmailResponse> responses = new List<EmailResponse>();

        for (EmailRequest req : requests) {
            EmailResponse resp = new EmailResponse();
            resp.email_result_data = new EmailOutput();

            EmailInput input = req.emailData;
            if (input != null) {
                // 受け取った入力値をそのまま出力値にセットしてパススルーする
                resp.email_result_data.toAddress = input.toAddress;
                resp.email_result_data.subject = input.subject;
                resp.email_result_data.body = input.body;
            }

            responses.add(resp);
        }

        return responses;
    }

    // 6. プロンプトテンプレートを呼び出してドラフトを生成するメソッド
    @AuraEnabled
    public static String generateEmailDraft(Id recordId) {
        try {
            // プロンプトテンプレートのインプットパラメータを設定
            ConnectApi.EinsteinPromptTemplateGenerationsInput promptInput = new ConnectApi.EinsteinPromptTemplateGenerationsInput();
            promptInput.isPreview = false;
            
            // Summer '24 以降、Salesforce側の内部エラーを回避するために additionalConfig が必須となるケースがある
            promptInput.additionalConfig = new ConnectApi.EinsteinLlmAdditionalConfigInput();
            
            Map<String, ConnectApi.WrappedValue> valueMap = new Map<String, ConnectApi.WrappedValue>();
            
            // 対象レコードをインプットとしてセット（Map<String,Object>形式が正解）
            ConnectApi.WrappedValue recordValue = new ConnectApi.WrappedValue();
            recordValue.value = new Map<String, Object>{'id' => recordId};
            
            // SObject名を動的に取得し、インプット変数のキーを構成する（例: 'Input:Opportunity'）
            String objectApiName = recordId.getSObjectType().getDescribe().getName();
            String inputKey = 'Input:' + objectApiName;
            valueMap.put(inputKey, recordValue);
            promptInput.inputParams = valueMap;
            
            // プロンプトテンプレートを呼び出し
            ConnectApi.EinsteinPromptTemplateGenerationsRepresentation generations = 
                ConnectApi.EinsteinLLM.generateMessagesForPromptTemplate('Generate_FollowUp_Draft', promptInput);
            
            if (generations != null && generations.generations != null && !generations.generations.isEmpty()) {
                String textResponse = generations.generations[0].text;
                return textResponse;
            }
            return null;
        } catch (Exception e) {
            System.debug('>>> Error in generateEmailDraft: ' + e.getMessage() + '\n' + e.getStackTraceString());
            throw new AuraHandledException('プロンプトテンプレートの実行中にエラーが発生しました: ' + e.getMessage());
        }
    }
}
