// Butler.UI - Azure infrastructure (placeholder scaffold)
//
// Hosts the web build of the Expo (React Native Web) app as an Azure Static Web App.
// Names and tags are fully parameter-driven so this template stays policy-agnostic:
// pass values that comply with the target subscription's Azure Policy at deploy time.
// (If deploying into a Frontier Energy subscription, generate names/tags with the
//  azure-resource-naming skill before wiring them into the .bicepparam file.)

targetScope = 'resourceGroup'

@description('Name for the Static Web App, e.g. "butler-ui-dev". Must satisfy the target subscription naming policy.')
param appName string

@description('Azure region. Static Web Apps are available in a limited set of regions.')
@allowed([
  'eastus2'
  'centralus'
  'westus2'
  'westeurope'
  'eastasia'
])
param location string = 'eastus2'

@description('Static Web App SKU. Free for dev; Standard for custom auth/APIs/SLA.')
@allowed([
  'Free'
  'Standard'
])
param skuName string = 'Free'

@description('Required resource tags per the target subscription policy.')
param tags object = {}

resource staticSite 'Microsoft.Web/staticSites@2023-12-01' = {
  name: appName
  location: location
  tags: tags
  sku: {
    name: skuName
    tier: skuName
  }
  properties: {
    // App source is published via CI/CD (GitHub Actions / azd), not from this template.
    allowConfigFileUpdates: true
  }
}

output defaultHostname string = staticSite.properties.defaultHostname
output staticSiteResourceId string = staticSite.id
