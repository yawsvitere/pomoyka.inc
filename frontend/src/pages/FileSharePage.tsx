import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiClient } from "../api/client";
import { ErrorPage } from "../components/ui/ErrorPage";
import "../styles/pages/file-manager.css";

export function FileSharePage() {
  const { fileId } = useParams();
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileType, setFileType] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!fileId) return;
    let objectUrl: string | null = null;
    void apiClient
      .get(`/api/files/library/${fileId}/download`, { responseType: "blob" })
      .then((response) => {
        objectUrl = URL.createObjectURL(response.data);
        const contentType = response.headers["content-type"];
        setFileType(typeof contentType === "string" ? contentType : "");
        setFileUrl(objectUrl);
      })
      .catch(() => setError(true));
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId]);

  if (error) {
    return <ErrorPage status={404} title="Файл не найден" />;
  }

  if (!fileUrl) return <div className="fm-gallery-empty"></div>;

  return (
    <main className="fm-gallery fm-file-share">
      {fileType.startsWith("image/") ? (
        <img src={fileUrl} alt="Общий файл" />
      ) : fileType.startsWith("video/") ? (
        <video src={fileUrl} controls autoPlay />
      ) : fileType.startsWith("audio/") ? (
        <audio src={fileUrl} controls autoPlay />
      ) : (
        <a className="btn btn-primary" href={fileUrl} download>
          Скачать файл
        </a>
      )}
    </main>
  );
}
