using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Butler.Api.Application.Auth;
using Butler.Api.Tests.TestSupport;

namespace Butler.Api.Tests.Auth;

/// <summary>
/// Criteria (#105 AC4-AC9, AC11, AC12): in Demo the configured PIN (from
/// <c>BUTLER_DEMO_PIN</c>) signs the organizer in with a short-lived token the
/// <c>Organizer</c> policy accepts; a wrong PIN is an RFC 7807 <c>401</c>; five
/// wrong PINs lock every attempt out for 60 s; the token expires after 15 idle
/// minutes, each use restarting the window; sign-out revokes it; and
/// <c>Authentication:Pin:*</c> overrides the defaults. Time comes from the
/// injected clock.
/// </summary>
public sealed class PinSignInTests
{
    private static readonly DateTimeOffset Start = new(2026, 11, 14, 9, 0, 0, TimeSpan.Zero);

    private static async Task<HttpStatusCode> MeStatusAsync(HttpClient client, string token)
    {
        using var response = await PinSignIn.GetWithBearerAsync(client, PinSignIn.MeUri, token);
        return response.StatusCode;
    }

    private static async Task<HttpStatusCode> SignInStatusAsync(HttpClient client, string pin)
    {
        using var response = await PinSignIn.SignInAsync(client, pin);
        return response.StatusCode;
    }

    [Theory]
    [InlineData("4321")]
    [InlineData("123456")]
    public async Task Configured_pin_is_accepted(string pin)
    {
        using var factory = PinSignIn.CreateDemoFactory(new MutableClock(Start), (PinOrganizerOptions.PinConfigurationKey, pin));
        using var client = factory.CreateClient();

        Assert.Equal(HttpStatusCode.OK, await SignInStatusAsync(client, pin));
        Assert.Equal(HttpStatusCode.Unauthorized, await SignInStatusAsync(client, ButlerApiFactory.DemoPin));
    }

    [Theory]
    [InlineData("")]
    [InlineData("123")]
    [InlineData("1234567")]
    [InlineData("12a4")]
    public void Startup_rejects_a_missing_or_malformed_pin(string pin)
    {
        using var factory = PinSignIn.CreateDemoFactory(new MutableClock(Start), (PinOrganizerOptions.PinConfigurationKey, pin));

        var exception = Assert.Throws<InvalidOperationException>(() => factory.CreateClient());

        Assert.Contains(PinOrganizerOptions.PinConfigurationKey, exception.Message, StringComparison.Ordinal);
        if (pin.Length > 0)
        {
            Assert.DoesNotContain(pin, exception.Message, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task Correct_pin_returns_a_token_the_organizer_policy_accepts()
    {
        using var factory = PinSignIn.CreateDemoFactory(new MutableClock(Start));
        using var client = factory.CreateClient();

        using var response = await PinSignIn.SignInAsync(client, ButlerApiFactory.DemoPin);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var token = doc.RootElement.GetProperty("token").GetString()!;
        Assert.Equal(OrganizerAuthorization.DevOrganizerSubject, doc.RootElement.GetProperty("subject").GetString());
        Assert.Equal(OrganizerAuthorization.PinOrganizerName, doc.RootElement.GetProperty("name").GetString());
        Assert.Equal(900, doc.RootElement.GetProperty("idleTimeoutSeconds").GetInt32());

        Assert.Equal(HttpStatusCode.OK, await MeStatusAsync(client, token));

        // An organizer-only write works with the token too.
        using var create = await PinSignIn.SendWithBearerAsync(
            client,
            HttpMethod.Post,
            new Uri("/households", UriKind.Relative),
            token,
            JsonContent.Create(new { name = "Home" }));
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
    }

    [Fact]
    public async Task Wrong_pin_is_a_problem_details_401()
    {
        using var factory = PinSignIn.CreateDemoFactory(new MutableClock(Start));
        using var client = factory.CreateClient();

        using var response = await PinSignIn.SignInAsync(client, "1111");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        var body = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain(ButlerApiFactory.DemoPin, body, StringComparison.Ordinal);
        using var doc = JsonDocument.Parse(body);
        Assert.Equal(401, doc.RootElement.GetProperty("status").GetInt32());
        Assert.Equal("The PIN is not correct.", doc.RootElement.GetProperty("title").GetString());
    }

    [Fact]
    public async Task Missing_pin_is_a_400()
    {
        using var factory = PinSignIn.CreateDemoFactory(new MutableClock(Start));
        using var client = factory.CreateClient();

        using var response = await client.PostAsJsonAsync(PinSignIn.SignInUri, new { });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Five_wrong_pins_lock_out_even_the_correct_pin_for_60_seconds()
    {
        var clock = new MutableClock(Start);
        using var factory = PinSignIn.CreateDemoFactory(clock);
        using var client = factory.CreateClient();

        for (var i = 0; i < 5; i++)
        {
            Assert.Equal(HttpStatusCode.Unauthorized, await SignInStatusAsync(client, "0000"));
        }

        using var locked = await PinSignIn.SignInAsync(client, ButlerApiFactory.DemoPin);
        Assert.Equal(HttpStatusCode.TooManyRequests, locked.StatusCode);
        Assert.Equal("application/problem+json", locked.Content.Headers.ContentType?.MediaType);
        Assert.Equal(TimeSpan.FromSeconds(60), locked.Headers.RetryAfter?.Delta);
        using var doc = JsonDocument.Parse(await locked.Content.ReadAsStringAsync());
        Assert.Equal(429, doc.RootElement.GetProperty("status").GetInt32());
        Assert.Equal(60, doc.RootElement.GetProperty("retryAfterSeconds").GetInt32());

        clock.Set(Start.AddSeconds(59));
        using var stillLocked = await PinSignIn.SignInAsync(client, ButlerApiFactory.DemoPin);
        Assert.Equal(HttpStatusCode.TooManyRequests, stillLocked.StatusCode);
        Assert.Equal(TimeSpan.FromSeconds(1), stillLocked.Headers.RetryAfter?.Delta);
    }

    [Fact]
    public async Task Correct_pin_is_accepted_again_after_the_lockout()
    {
        var clock = new MutableClock(Start);
        using var factory = PinSignIn.CreateDemoFactory(clock);
        using var client = factory.CreateClient();
        for (var i = 0; i < 5; i++)
        {
            await SignInStatusAsync(client, "0000");
        }

        clock.Set(Start.AddSeconds(60));

        Assert.Equal(HttpStatusCode.OK, await SignInStatusAsync(client, ButlerApiFactory.DemoPin));
    }

    [Fact]
    public async Task Token_expires_after_15_minutes_idle()
    {
        var clock = new MutableClock(Start);
        using var factory = PinSignIn.CreateDemoFactory(clock);
        using var client = factory.CreateClient();
        var token = await PinSignIn.TokenAsync(client);

        clock.Set(Start.AddMinutes(15));

        using var response = await PinSignIn.GetWithBearerAsync(client, PinSignIn.MeUri, token);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, await MeStatusAsync(client, token));
    }

    [Fact]
    public async Task Each_use_restarts_the_idle_window()
    {
        var clock = new MutableClock(Start);
        using var factory = PinSignIn.CreateDemoFactory(clock);
        using var client = factory.CreateClient();
        var token = await PinSignIn.TokenAsync(client);
        var almost = TimeSpan.FromMinutes(14) + TimeSpan.FromSeconds(59);

        clock.Set(Start + almost);
        Assert.Equal(HttpStatusCode.OK, await MeStatusAsync(client, token));

        clock.Set(Start + almost + almost);
        Assert.Equal(HttpStatusCode.OK, await MeStatusAsync(client, token));

        clock.Set(Start + almost + almost + TimeSpan.FromMinutes(15));
        Assert.Equal(HttpStatusCode.Unauthorized, await MeStatusAsync(client, token));
    }

    [Fact]
    public async Task Sign_out_revokes_the_token()
    {
        using var factory = PinSignIn.CreateDemoFactory(new MutableClock(Start));
        using var client = factory.CreateClient();
        var token = await PinSignIn.TokenAsync(client);

        using var signOut = await PinSignIn.SendWithBearerAsync(client, HttpMethod.Post, PinSignIn.SignOutUri, token);
        Assert.Equal(HttpStatusCode.NoContent, signOut.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, await MeStatusAsync(client, token));

        // Idempotent: signing out again, or with no token at all, still succeeds.
        using var again = await PinSignIn.SendWithBearerAsync(client, HttpMethod.Post, PinSignIn.SignOutUri, token);
        Assert.Equal(HttpStatusCode.NoContent, again.StatusCode);
        using var bare = await client.PostAsync(PinSignIn.SignOutUri, content: null);
        Assert.Equal(HttpStatusCode.NoContent, bare.StatusCode);
    }

    [Fact]
    public async Task Unknown_token_is_rejected()
    {
        using var factory = PinSignIn.CreateDemoFactory(new MutableClock(Start));
        using var client = factory.CreateClient();

        Assert.Equal(HttpStatusCode.Unauthorized, await MeStatusAsync(client, "not-a-real-token"));
    }

    [Fact]
    public async Task Configured_threshold_lockout_and_idle_override_the_defaults()
    {
        var clock = new MutableClock(Start);
        using var factory = PinSignIn.CreateDemoFactory(
            clock,
            ("Authentication:Pin:MaxFailedAttempts", "2"),
            ("Authentication:Pin:LockoutDuration", "00:00:10"),
            ("Authentication:Pin:IdleTimeout", "00:02:00"));
        using var client = factory.CreateClient();

        Assert.Equal(HttpStatusCode.Unauthorized, await SignInStatusAsync(client, "0000"));
        Assert.Equal(HttpStatusCode.Unauthorized, await SignInStatusAsync(client, "0000"));
        using (var locked = await PinSignIn.SignInAsync(client, ButlerApiFactory.DemoPin))
        {
            Assert.Equal(HttpStatusCode.TooManyRequests, locked.StatusCode);
            Assert.Equal(TimeSpan.FromSeconds(10), locked.Headers.RetryAfter?.Delta);
        }

        clock.Set(Start.AddSeconds(10));
        using var signIn = await PinSignIn.SignInAsync(client, ButlerApiFactory.DemoPin);
        Assert.Equal(HttpStatusCode.OK, signIn.StatusCode);
        using var doc = JsonDocument.Parse(await signIn.Content.ReadAsStringAsync());
        Assert.Equal(120, doc.RootElement.GetProperty("idleTimeoutSeconds").GetInt32());
        var token = doc.RootElement.GetProperty("token").GetString()!;

        clock.Set(Start.AddSeconds(10).AddMinutes(2));
        Assert.Equal(HttpStatusCode.Unauthorized, await MeStatusAsync(client, token));
    }
}
