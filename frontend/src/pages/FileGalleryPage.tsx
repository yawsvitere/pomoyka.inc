import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import * as filesApi from "../api/files";
import { Spinner } from "../components/ui/Spinner";
import { ErrorPage } from "../components/ui/ErrorPage";
import { Pinterest } from "../components/ui/Pinterest";
import "../styles/pages/file-manager.css";
import "../styles/pages/file-gallery.css";

export function FileGalleryPage() {
  const { folderId } = useParams();
  const [gallery, setGallery] = useState<Awaited<
    ReturnType<typeof filesApi.getGallery>
  > | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorStatus, setErrorStatus] = useState<404 | 500 | null>(null);

  useEffect(() => {
    if (!folderId) {
      setIsLoading(false);
      setErrorStatus(404);
      return;
    }

    setIsLoading(true);
    setErrorStatus(null);
    void filesApi
      .getGallery(folderId)
      .then(setGallery)
      .catch((error: { response?: { status?: number } }) => {
        setGallery(null);
        setErrorStatus(error.response?.status === 404 ? 404 : 500);
      })
      .finally(() => setIsLoading(false));
  }, [folderId]);

  useEffect(() => {
    if (!gallery || !folderId) return;

    const previousTitle = document.title;
    const description = `Фото из коллекции «${gallery.name.trim()}» на Помойка.inc.`;
    const title = `Коллекция «${gallery.name.trim()}» — Помойка.inc`;
    const galleryUrl = `${window.location.origin}/files/gallery/${folderId}`;
    const imageUrl = `${window.location.origin}/gallery-og/${folderId}.png`;
    const metaValues = [
      ['meta[name="description"]', "name", description],
      ['meta[property="og:site_name"]', "property", "Помойка.inc"],
      ['meta[property="og:type"]', "property", "website"],
      ['meta[property="og:title"]', "property", title],
      ['meta[property="og:description"]', "property", description],
      ['meta[property="og:url"]', "property", galleryUrl],
      ['meta[property="og:image"]', "property", imageUrl],
      ['meta[property="og:image:width"]', "property", "1200"],
      ['meta[property="og:image:height"]', "property", "630"],
      ['meta[name="twitter:card"]', "name", "summary_large_image"],
      ['meta[name="twitter:title"]', "name", title],
      ['meta[name="twitter:description"]', "name", description],
      ['meta[name="twitter:image"]', "name", imageUrl],
    ] as const;

    document.title = title;
    const previousMeta = metaValues.map(([selector]) => {
      const element = document.head.querySelector<HTMLMetaElement>(selector);
      return { element, content: element?.content };
    });

    metaValues.forEach(([selector, attribute, content]) => {
      let element = document.head.querySelector<HTMLMetaElement>(selector);
      if (!element) {
        element = document.createElement("meta");
        element.setAttribute(attribute, selector.split('"')[1]);
        document.head.appendChild(element);
      }
      element.content = content;
    });

    return () => {
      document.title = previousTitle;
      metaValues.forEach(([selector], index) => {
        const { element, content } = previousMeta[index];
        if (element && content !== undefined) {
          element.content = content;
        } else {
          document.head.querySelector(selector)?.remove();
        }
      });
    };
  }, [folderId, gallery]);

  if (isLoading)
    return (
      <div className="fm-gallery-empty">
        <Spinner label="Загрузка галереи" />
      </div>
    );
  if (errorStatus) {
    return errorStatus === 404 ? (
      <ErrorPage
        status={404}
        title="Галерея не найдена"
        description="Она была удалена, закрыта владельцем или такого адреса не существует."
      />
    ) : (
      <ErrorPage
        status={500}
        title="Не удалось открыть галерею"
        description="При загрузке галереи произошла ошибка. Попробуйте еще раз позже."
      />
    );
  }
  if (!gallery) return <ErrorPage status={500} />;
  return (
    <main className="fm-gallery">
      <h1>{gallery.name}</h1>
      <Pinterest images={gallery.images} />
    </main>
  );
}