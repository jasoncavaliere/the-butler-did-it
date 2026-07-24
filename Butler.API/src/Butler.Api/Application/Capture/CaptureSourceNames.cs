namespace Butler.Api.Application.Capture;

/// <summary>
/// The identities of the v1 <see cref="ICaptureSource"/> implementations (BRD
/// decision D-5). Every capture result is stamped with the source that produced
/// it, and the API routes select a source by these names, so the constants are
/// the one place the names are spelled out - a route and a registration can never
/// drift apart.
/// </summary>
/// <remarks>
/// Only the two v1 sources are listed. Live Alexa capture is deliberately absent:
/// it is a BRD Section 9 fast-follow that plugs in behind
/// <see cref="ICaptureSource"/> later and is explicitly out of scope for G3.
/// </remarks>
public static class CaptureSourceNames
{
    /// <summary>Text typed at the hub (the shared tablet's add-an-item field).</summary>
    public const string HubText = "hub-text";

    /// <summary>
    /// A simulated voice transcript - the stand-in for a real speech assistant, so
    /// the voice path is exercised end to end with no external dependency.
    /// </summary>
    public const string SimulatedVoice = "simulated-voice";
}
