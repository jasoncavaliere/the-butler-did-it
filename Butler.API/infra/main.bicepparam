using './main.bicep'

// Fill these in per environment. Names/tags must satisfy the target subscription's Azure Policy.
// If deploying to a Frontier Energy subscription, generate compliant values with the
// azure-resource-naming skill before committing real values here.
param appName = 'butler-api-dev'
param location = 'eastus'
param skuName = 'B1'
param tags = {
  application: 'butler'
  component: 'api'
  environment: 'dev'
}
