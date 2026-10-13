import { useEffect, useState } from "react";
import * as filesApi from "../api/files";
import { Pinterest } from "../components/ui/Pinterest";
import { Spinner } from "../components/ui/Spinner";
import { useToast } from "../components/ui/useToast";
import "../styles/pages/pinterest.css";

function shuffleMedia(items: filesApi.PinterestMedia[]) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled;
}

export function PinterestPage() {
  const { notify } = useToast();
  const [media, setMedia] = useState<filesApi.PinterestMedia[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void filesApi.getPinterestMedia()
      .then((items) => {
        if (active) setMedia(shuffleMedia(items));
      })
      .catch(() => {
        if (active) {
          setLoadFailed(true);
          notify("error", "Не удалось загрузить Pinterest");
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [notify]);

  if (isLoading) {
    return <div className="pinterest-page-state"><Spinner label="Загрузка Pinterest" /></div>;
  }

  const images = media.map((item) => ({
    id: item.id,
    fileName: item.fileName,
    url: item.downloadUrl,
    contentType: item.contentType,
    width: item.width,
    height: item.height,
    previewUrl: item.previewUrl,
  }));

  return (
    <section className="pinterest-page">
      <header className="pinterest-page-header">
      </header>
      {images.length > 0 ? (
        <Pinterest images={images} />
      ) : loadFailed ? null : (
        <p className="pinterest-page-empty">Пока нет доступных изображений и видео</p>
      )}
    </section>
  );
}