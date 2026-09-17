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