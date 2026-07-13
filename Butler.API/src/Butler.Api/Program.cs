var builder = WebApplication.CreateBuilder(args);

// OpenAPI + Swagger UI (Swashbuckle) so the API is browsable at /swagger.
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new() { Title = "Butler API", Version = "v1" });
});

// Dev CORS: let the local UI (Expo web dev server) call the API from another origin.
const string DevCors = "butler-dev";
builder.Services.AddCors(options =>
{
    options.AddPolicy(DevCors, policy =>
        policy.WithOrigins(
                "http://localhost:8081",   // Expo web dev server
                "http://localhost:19006")  // legacy Expo web port
            .AllowAnyHeader()
            .AllowAnyMethod());
});

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(options =>
    {
        options.SwaggerEndpoint("/swagger/v1/swagger.json", "Butler API v1");
        options.RoutePrefix = "swagger";
    });
    // Convenience: send the site root to the Swagger UI in development.
    app.MapGet("/", () => Results.Redirect("/swagger")).ExcludeFromDescription();
}

app.UseCors(DevCors);

// Liveness probe.
app.MapGet("/health", () => Results.Ok(new { status = "ok" }))
    .WithName("Health")
    .WithTags("System");

// Sample payload: a slice of the household model (rooms -> people -> chores),
// the shared spine the product vision describes. Placeholder data for now.
app.MapGet("/api/hello", () => Results.Ok(new HelloResponse(
        Service: "Butler.API",
        Status: "ok",
        Message: "The Butler is at your service.",
        TimestampUtc: DateTime.UtcNow,
        SampleHousehold: new Household(
            Name: "The Cavaliere Household",
            Rooms: new[] { "Kitchen", "Living Room", "Garage" },
            Members: new[]
            {
                new Member("Alex", "organizer"),
                new Member("Maya", "child"),
            },
            SampleChore: new Chore("Take out the trash", Room: "Kitchen", AssignedTo: "Maya", Done: false)))))
    .WithName("Hello")
    .WithTags("Butler");

app.Run();

record HelloResponse(string Service, string Status, string Message, DateTime TimestampUtc, Household SampleHousehold);
record Household(string Name, string[] Rooms, Member[] Members, Chore SampleChore);
record Member(string Name, string Role);
record Chore(string Title, string Room, string AssignedTo, bool Done);
