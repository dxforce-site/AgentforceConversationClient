public with sharing class EmployeeAgentConfigController {
    @AuraEnabled(cacheable=true)
    public static Map<String, String> getConfig(String developerName) {
        EmployeeAgentConfig__mdt config = EmployeeAgentConfig__mdt.getInstance(developerName);
        if (config != null) {
            return new Map<String, String>{
                'botId' => config.BotId__c,
                'targetProfiles' => config.TargetProfiles__c
            };
        }
        return null;
    }
}
