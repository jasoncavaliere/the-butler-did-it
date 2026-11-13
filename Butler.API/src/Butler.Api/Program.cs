using Butler.Api.Application.Assignments;
using Butler.Api.Application.Capture;
using Butler.Api.Application.Carts;
using Butler.Api.Application.Chores;
using Butler.Api.Application.Demo;
using Butler.Api.Application.Fairness;
using Butler.Api.Application.Grocery;
using Butler.Api.Application.Households;
using Butler.Api.Application.HubDevices;
using Butler.Api.Application.People;
using Butler.Api.Application.Rooms;
using Butler.Api.Application.System;
using Butler.Api.Infrastructure.Auth;
using Butler.Api.Infrastructure.Hosting;
using Butler.Api.Infrastructure.Storage;
using Butler.Api.Mediation;

// `--seed-demo` is rewritten to `--Demo:SeedOnStartup=true` before the
// command-line configuration provider sees it (a bare switch would swallow the
// next argument as its value).
var builder = WebApplication.CreateBuilder(DemoCommandLine.Normalize(args));

// --- Composition root ----------------------------------------------------
// Program.cs wires each feature via its Add<Feature>Feature() extension. To add
// a feature: create Application/<Feature>/ (+ Infrastructure/<Feature>/), expose
// Add<Feature>Feature(), and register it below. See Engineering Contract 7.2.

// Thin controllers hand requests to MediatR.
builder.Services.AddControllers();

// MediatR: discover commands/queries and their handlers in this assembly.
builder.Services.AddMediatR(cfg =>
    cfg.RegisterServicesFromAssembly(typeof(Program).Assembly));

// RFC 7807 problem details for every error path (Section 7.5).
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<ApiExceptionHandler>();

// Shared persistence seam (Engineering Contract 7.3): the Table Storage client
// factory + options. Feature modules register their own tables on top with
// services.AddTableRepository<TEntity>("<TableName>"); with no storage
// configured the seam falls back to the in-memory seed store automatically.
builder.Services.AddStorage(builder.Configuration);

// Organizer authentication seam (Engineering Contract 7.4): JWT bearer against
// Entra External ID + the Organizer authorization policy. The bypass defaults on
// only in Development, is permitted in Demo when set explicitly
// (appsettings.Demo.json), and fails closed in every other environment.
builder.Services.AddOrganizerAuthentication(builder.Configuration, builder.Environment);

// Features.
builder.Services.AddSystemFeature();
builder.Services.AddHouseholdFeature();
builder.Services.AddPeopleFeature();
builder.Services.AddRoomsFeature();
builder.Services.AddChoresFeature();
builder.Services.AddHubDevicesFeature();
builder.Services.AddAssignmentsFeature();
builder.Services.AddFairnessFeature();
builder.Services.AddStoreConnectorFeature();
builder.Services.AddCartsFeature();
builder.Services.AddCaptureFeature();
// Demo seeder (#97): Development and Demo only; composes the features above.
builder.Services.AddDemoFeature();

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

// All errors become RFC 7807 problem details via the shared handler.
app.UseExceptionHandler();

// Swagger is served in Development and Demo (the local demo stack, for live
// troubleshooting); never in other environments.
if (app.Environment.IsDevelopmentOrDemo())
{
    app.UseSwagger();
    app.UseSwaggerUI(options =>
    {
        options.SwaggerEndpoint("/swagger/v1/swagger.json", "Butler API v1");
        options.RoutePrefix = "swagger";
    });
    // Convenience: send the site root to the Swagger UI in Development and Demo.
    app.MapGet("/", () => Results.Redirect("/swagger")).ExcludeFromDescription();
}

app.UseCors(DevCors);

// Authenticate the caller, then enforce authorization policies (the Organizer
// policy on protected endpoints such as GET /me).
app.UseAuthentication();
app.UseAuthorization();

// Liveness probe.
app.MapGet("/health", () => Results.Ok(new { status = "ok" }))
    .WithName("Health")
    .WithTags("System");

app.MapControllers();

// `--seed-demo` / Demo__SeedOnStartup=true: seed the demo household, then serve.
await app.SeedDemoIfRequestedAsync();

app.Run();

// Exposed so the test project (arriving in F2) and MediatR's assembly scan can
// reference this assembly by its entry-point type.
public partial class Program;
