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
/// <remarks>
/// The host is pinned to the Development environment - the "local + CI" default
/// (Engineering Contract 7.4), where organizer authentication is disabled and a
/// deterministic dev-organizer principal is injected, so tests need no live
/// tenant. Tests that need a different environment or auth configuration compose
/// this factory with <see cref="Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory{TEntryPoint}.WithWebHostBuilder"/>.
/// </remarks>
public sealed class ButlerApiFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");

        builder.ConfigureTestServices(services =>
            services.AddControllers()
                .AddApplicationPart(typeof(ButlerApiFactory).Assembly));
    }
}
