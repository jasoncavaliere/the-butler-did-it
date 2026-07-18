using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Butler.Api.Tests.TestSupport;

/// <summary>
/// Boots the real <c>Butler.Api</c> application (its actual <c>Program.cs</c>
/// composition root and middleware pipeline) in-memory for integration tests,
/// adding the test assembly as an MVC application part so the test-only
/// <see cref="ThrowingTestController"/> endpoints are routable. Production
/// registrations are otherwise untouched.
/// </summary>
public sealed class ButlerApiFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureTestServices(services =>
            services.AddControllers()
                .AddApplicationPart(typeof(ButlerApiFactory).Assembly));
    }
}
