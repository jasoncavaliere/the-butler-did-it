# Butler.API container image for the local demo stack (#94).
#
# Build from Butler.API/ (the build context):
#   docker build -t butler-api:demo .
#
# The image defaults to ASPNETCORE_ENVIRONMENT=Demo and listens on port 8080.
# The storage connection is passed at run time through the Storage__*
# environment variables (see README "Run as a container") - it is never baked
# into the image. Without it the API falls back to the in-memory seed store.

# --- Build stage: .NET 10 SDK -----------------------------------------------
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

# Solution-level MSBuild inputs: SDK pin, TFM/analyzers, central package versions.
COPY global.json Directory.Build.props Directory.Packages.props ./

# Restore the API project only (the solution also references the test project,
# which .dockerignore keeps out of the build context).
COPY src/Butler.Api/Butler.Api.csproj src/Butler.Api/
RUN dotnet restore src/Butler.Api/Butler.Api.csproj

COPY src/Butler.Api/ src/Butler.Api/
RUN dotnet publish src/Butler.Api/Butler.Api.csproj \
    --configuration Release \
    --output /app/publish \
    --no-restore \
    /p:UseAppHost=false

# --- Final stage: ASP.NET 10 runtime ----------------------------------------
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app

ENV ASPNETCORE_HTTP_PORTS=8080 \
    ASPNETCORE_ENVIRONMENT=Demo

EXPOSE 8080

COPY --from=build /app/publish .

# Run as the non-root user the .NET runtime images define.
USER $APP_UID

ENTRYPOINT ["dotnet", "Butler.Api.dll"]
