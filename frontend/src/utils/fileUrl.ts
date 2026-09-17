export function getBrowserFileUrl(url: string) {
  const normalizedUrl = url.replace(/^https:\/\//i, "http://");

  if (/^https?:\/\/[^/]+:9000\//i.test(normalizedUrl)) return normalizedUrl;

  const token = localStorage.getItem("token");
  if (!token || !normalizedUrl.includes("/api/files/")) return normalizedUrl;

  const browserUrl = new URL(normalizedUrl, window.location.origin);
  browserUrl.searchParams.set("access_token", token);
  return browserUrl.href;
}

export function getImageProxyUrl(url: string, width: number) {
  const proxyBaseUrl = (import.meta.env.VITE_IMGPROXY_URL || '/imgproxy').replace(/\/$/, '');
  const sourceBaseUrl = import.meta.env.VITE_IMGPROXY_SOURCE_URL || 'http://minio:9000';
  const sourceUrl = new URL(url);
  const proxySourceUrl = new URL(`${sourceUrl.pathname}${sourceUrl.search}`, sourceBaseUrl).href;
  return `${proxyBaseUrl}/insecure/rs:fit:${width}:0/plain/${encodeURIComponent(proxySourceUrl)}@webp`;
}

export function getImagePreviewUrl(url: string, width: number) {
  if (/\/previews\/.*\.webp(?:\?|$)/i.test(url)) return getBrowserFileUrl(url);
  return getImageProxyUrl(getBrowserFileUrl(url), width);
}
