import { useState } from "react";
import type { SyntheticEvent } from "react";
import { Audio, AudioPlayer, AudioSkin } from "@videojs/react/audio";
import { Video, VideoPlayer, VideoSkin } from "@videojs/react/video";
import "@videojs/react/audio/skin.css";
import "@videojs/react/video/skin.css";
import "../../styles/components/media-modal.css";

export function MediaModal({
  type,
  name,
  url,
  onClose,
}: {
  type: "video" | "audio";
  name: string;
  url: string;
  onClose: () => void;
}) {
  const [videoAspectRatio, setVideoAspectRatio] = useState(16 / 9);
  const displayName = name.length > 40 ? `${name.slice(0, 39)}…` : name;

  function handleVideoMetadata(event: SyntheticEvent<HTMLVideoElement>) {
    const video = event.currentTarget;
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      setVideoAspectRatio(video.videoWidth / video.videoHeight);
    }
  }

  return (
    <div
      className="media-modal"
      role="dialog"
      aria-modal="true"
      aria-label={name}
      onClick={onClose}
    >
      <div
        className="media-modal-content"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="media-modal-header">
          <strong className="media-modal-title" title={name}>
            {displayName}
          </strong>
          <button
            type="button"
            className="btn btn-icon media-modal-close"
            aria-label="Закрыть плеер"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {type === "video" ? (
          <div
            className="media-video-stage"
            style={{ "--media-video-ratio": videoAspectRatio } as React.CSSProperties}
          >
            <VideoPlayer>
              <VideoSkin>
                <Video
                  src={url}
                  playsInline
                  autoPlay
                  onLoadedMetadata={handleVideoMetadata}
                />
              </VideoSkin>
            </VideoPlayer>
          </div>
        ) : (
          <AudioPlayer>
            <AudioSkin>
              <Audio src={url} autoPlay />
            </AudioSkin>
          </AudioPlayer>
        )}
      </div>
    </div>
  );
}
