FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build

WORKDIR /src

COPY src/Feed.Api/Feed.Api.csproj src/Feed.Api/

RUN dotnet restore src/Feed.Api/Feed.Api.csproj

COPY src/Feed.Api/ src/Feed.Api/

RUN dotnet publish src/Feed.Api/Feed.Api.csproj \
    --configuration Release \
    --no-restore \
    --output /app/publish \
    /p:UseAppHost=false


FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg p7zip-full \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/publish .

ENV ASPNETCORE_URLS=http://+:8080

EXPOSE 8080

ENTRYPOINT ["dotnet", "Feed.Api.dll"]