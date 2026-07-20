using System.Buffers.Text;
using System.Text;
using Butler.Api.Application.Auth;

namespace Butler.Api.Tests.TapToClaim;

/// <summary>
/// Unit tests for the participant session token codec (T1). The token must
/// round-trip exactly the <c>(householdId, personId)</c> it was minted for, and
/// every malformed or incomplete form must be rejected rather than mistaken for a
/// valid session.
/// </summary>
public sealed class ParticipantSessionTokenTests
{
    [Fact]
    public void Encode_then_decode_round_trips_the_household_and_person()
    {
        var token = ParticipantSession.Encode("house-1", "person-9");

        var decoded = ParticipantSession.TryDecode(token, out var householdId, out var personId);

        Assert.True(decoded);
        Assert.Equal("house-1", householdId);
        Assert.Equal("person-9", personId);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void TryDecode_rejects_a_null_or_blank_token(string? token)
    {
        Assert.False(ParticipantSession.TryDecode(token, out var householdId, out var personId));
        Assert.Equal(string.Empty, householdId);
        Assert.Equal(string.Empty, personId);
    }

    [Fact]
    public void TryDecode_rejects_a_token_that_is_not_base64url()
    {
        // Padding/illegal characters are not valid base64url -> FormatException path.
        Assert.False(ParticipantSession.TryDecode("!!not-base64!!", out _, out _));
    }

    [Fact]
    public void TryDecode_rejects_base64url_that_is_not_the_expected_json()
    {
        var notJson = Base64Url.EncodeToString(new byte[] { 0xFF, 0xFE, 0x00 });

        Assert.False(ParticipantSession.TryDecode(notJson, out _, out _));
    }

    [Fact]
    public void TryDecode_rejects_a_json_null_payload()
    {
        var jsonNull = Encode("null");

        Assert.False(ParticipantSession.TryDecode(jsonNull, out _, out _));
    }

    [Theory]
    [InlineData("{\"h\":\"\",\"p\":\"person-1\"}")]
    [InlineData("{\"h\":\"house-1\",\"p\":\"\"}")]
    [InlineData("{\"p\":\"person-1\"}")]
    [InlineData("{\"h\":\"house-1\"}")]
    public void TryDecode_rejects_a_payload_missing_either_scope_field(string json)
    {
        Assert.False(ParticipantSession.TryDecode(Encode(json), out _, out _));
    }

    private static string Encode(string json) => Base64Url.EncodeToString(Encoding.UTF8.GetBytes(json));
}
