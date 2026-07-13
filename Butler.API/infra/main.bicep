// Butler.API - Azure infrastructure (placeholder scaffold)
//
// Hosts the .NET 9 Web API as an Azure App Service (Linux).
// Names and tags are fully parameter-driven so this template stays policy-agnostic:
// pass values that comply with the target subscription's Azure Policy at deploy time.
// (If deploying into a Frontier Energy subscription, generate names/tags with the
//  azure-resource-naming skill before wiring them into the .bicepparam file.)

targetScope = 'resourceGroup'

@description('Base name for resources, e.g. "butler-api-dev". Must satisfy the target subscription naming policy.')
param appName string

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('App Service plan SKU. B1 for dev; scale up for prod.')
param skuName string = 'B1'

@description('Required resource tags (owner, environment, cost-center, etc.) per the target subscription policy.')
param tags object = {}

@description('.NET runtime stack for the Linux App Service.')
param linuxFxVersion string = 'DOTNETCORE|9.0'

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${appName}-plan'
  location: location
  tags: tags
  sku: {
    name: skuName
  }
  kind: 'linux'
  properties: {
    reserved: true // required for Linux
  }
}

resource api 'Microsoft.Web/sites@2023-12-01' = {
  name: appName
  location: location
  tags: tags
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: linuxFxVersion
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      http20Enabled: true
      appSettings: [
        {
          name: 'ASPNETCORE_ENVIRONMENT'
          value: 'Production'
        }
      ]
    }
  }
}

output apiDefaultHostname string = api.properties.defaultHostName
output apiResourceId string = api.id
