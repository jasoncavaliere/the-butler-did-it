using './main.bicep'

// Fill these in per environment. Names/tags must satisfy the target subscription's Azure Policy.
// If deploying to a Frontier Energy subscription, generate compliant values with the
// azure-resource-naming skill before committing real values here.
param appName = 'butler-ui-dev'
param location = 'eastus2'
param skuName = 'Free'
param tags = {
  application: 'butler'
  component: 'ui'
  environment: 'dev'
}
