namespace Butler.Api.Infrastructure.Hosting;

/// <summary>
/// Marks a controller as demo-only (#106). <see cref="DemoOnlyControllerFeatureProvider"/>
/// registers it only in the Development and Demo environments; everywhere else
/// the controller is not mapped at all, so its routes answer <c>404</c> for every
/// caller, with or without credentials (no endpoint, so no <c>401</c>/<c>403</c>).
/// </summary>
[AttributeUsage(AttributeTargets.Class, Inherited = false, AllowMultiple = false)]
public sealed class DemoOnlyAttribute : Attribute
{
}
