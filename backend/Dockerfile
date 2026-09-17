FROM alpine:3.22 AS ffmpeg

RUN apk add --no-cache curl tar xz

RUN curl -L \
    https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-11-13-20/ffmpeg-n9.0.1-29-gad500d59cb-linux64-gpl-9.0.tar.xz \
    -o /tmp/ffmpeg.tar.xz \
    && mkdir /tmp/ffmpeg \
    && tar -xJf /tmp/ffmpeg.tar.xz -C /tmp/ffmpeg --strip-components=1 \
    && cp /tmp/ffmpeg/bin/ffmpeg /ffmpeg


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


COPY --from=ffmpeg /ffmpeg /usr/local/bin/ffmpeg

COPY --from=build /app/publish .

ENV ASPNETCORE_URLS=http://+:8080

EXPOSE 8080

ENTRYPOINT ["dotnet", "Feed.Api.dll"]