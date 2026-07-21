using System.Buffers.Text;
using System.Text;
using Butler.Api.Application.Auth;

namespace Butler.Api.Tests.HubDevices;

/// <summary>
/// Unit tests for the hub device token codec (T5). The token must round-trip
/// exactly the <c>(householdId, deviceId)</c> it was minted for, and every
/// malformed or incomplete form must be rejected rather than mistaken for a valid
/// device credential.
/// </summary>
public sealed class DeviceTokenTests
{
    [Fact]
    public void Encode_then_decode_round_trips_the_household_and_device()
    {
        var token = DeviceToken.Encode("house-1", "device-9");

        var decoded = DeviceToken.TryDecode(token, out var householdId, out var deviceId);

        Assert.True(decoded);
        Assert.Equal("house-1", householdId);
        Assert.Equal("device-9", deviceId);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void TryDecode_rejects_a_null_or_blank_token(string? token)
    {
        Assert.False(DeviceToken.TryDecode(token, out var householdId, out var deviceId));
        Assert.Equal(string.Empty, householdId);
        Assert.Equal(string.Empty, deviceId);
    }

    [Fact]
    public void TryDecode_rejects_a_token_that_is_not_base64url()
    {
        // Padding/illegal characters are not valid base64url -> FormatException path.
        Assert.False(DeviceToken.TryDecode("!!not-base64!!", out _, out _));
    }

    [Fact]
    public void TryDecode_rejects_base64url_that_is_not_the_expected_json()
    {
        var notJson = Base64Url.EncodeToString(new byte[] { 0xFF, 0xFE, 0x00 });

        Assert.False(DeviceToken.TryDecode(notJson, out _, out _));
    }

    [Fact]
    public void TryDecode_rejects_a_json_null_payload()
    {
        var jsonNull = Encode("null");

        Assert.False(DeviceToken.TryDecode(jsonNull, out _, out _));
    }

    [Theory]
    [InlineData("{\"h\":\"\",\"d\":\"device-1\"}")]
    [InlineData("{\"h\":\"house-1\",\"d\":\"\"}")]
    [InlineData("{\"d\":\"device-1\"}")]
    [InlineData("{\"h\":\"house-1\"}")]
    public void TryDecode_rejects_a_payload_missing_either_scope_field(string json)
    {
        Assert.False(DeviceToken.TryDecode(Encode(json), out _, out _));
    }

    [Theory]
    [InlineData(null, "device-1")]
    [InlineData("", "device-1")]
    [InlineData("house-1", null)]
    [InlineData("house-1", "")]
    public void Encode_rejects_a_missing_scope_argument(string? householdId, string? deviceId)
    {
        Assert.ThrowsAny<ArgumentException>(() => DeviceToken.Encode(householdId!, deviceId!));
    }

    private static string Encode(string json) => Base64Url.EncodeToString(Encoding.UTF8.GetBytes(json));
}
