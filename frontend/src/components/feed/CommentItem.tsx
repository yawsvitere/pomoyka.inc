import { useRef, useState } from "react";
import { PhotoView } from "react-photo-view";
import type { Comment } from "../../api/types";
import { AvatarMedia } from "../ui/AvatarMedia";
import { getBrowserFileUrl } from "../../utils/fileUrl";
import { useAuth } from "../../context/AuthContext";
import { ContextMenu, ReactionChip } from "./ContextMenu";
import { AppLink } from "../ui/AppLink";

interface CommentItemProps {
  comment: Comment;
  onReaction?: (commentId: string, emoji: string) => void;
}

export function CommentItem({ comment, onReaction }: CommentItemProps) {
  const { user } = useAuth();
  const [reactionAnimation, setReactionAnimation] = useState<{
    emoji: string;
    trigger: number;
  } | null>(null);
  const reactionAnimationCounterRef = useRef(0);
  const handleContextReaction = (emoji: string) => {
    const isAlreadyMine = comment.reactions.some(
      (reaction) => reaction.emoji === emoji && reaction.user.id === user?.id,
    );
    if (!isAlreadyMine) {
      reactionAnimationCounterRef.current += 1;
      setReactionAnimation({
        emoji,
        trigger: reactionAnimationCounterRef.current,
      });
    }
    onReaction?.(comment.id, emoji);
  };
  const imageFiles =
    comment.files?.filter((file) => file.contentType.startsWith("image/")) ??
    [];

  const commentContent = (
    <div className="comment">
      {comment.author.avatarUrl ? (
        <AvatarMedia
          className="comment-avatar"
          src={getBrowserFileUrl(comment.author.avatarUrl)}
          alt=""
        />
      ) : (
        <span className="comment-avatar comment-avatar-fallback">
          {comment.author.displayName.charAt(0).toUpperCase()}
        </span>
      )}
      <div className="comment-content">
        <div className="comment-bubble">
          <div className="comment-header">
            <AppLink
              className="comment-author-link"
              to={`/profile/${encodeURIComponent(comment.author.displayName)}`}
              style={{ color: comment.author.nicknameColor ?? "#4f46e5" }}
            >
              {comment.author.displayName}
            </AppLink>
            <time className="comment-time" dateTime={comment.createdAt}>
              {new Date(comment.createdAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          </div>
          <p className="comment-text">{comment.text}</p>
        </div>
        {imageFiles.length > 0 && (
          <div
            className="comment-images"
            data-count={Math.min(imageFiles.length, 6)}
          >
            {imageFiles.map((file) => {
              const imageUrl = getBrowserFileUrl(
                file.previewUrl || file.downloadUrl,
              );
              return (
                <PhotoView key={file.id} src={imageUrl}>
                  <img
                    className="comment-image"
                    src={imageUrl}
                    alt={file.fileName}
                    loading="lazy"
                  />
                </PhotoView>
              );
            })}
          </div>
        )}
        {Object.keys(comment.reactionCounts).length > 0 && (
          <div className="comment-reactions">
            {Object.entries(comment.reactionCounts).map(([emoji, count]) => {
              const reactions = comment.reactions.filter(
                (reaction) => reaction.emoji === emoji,
              );
              const isMine = reactions.some(
                (reaction) => reaction.user.id === user?.id,
              );
              const MAX_REACTION_AVATARS = 5;
              const visibleReactions = reactions.slice(0, MAX_REACTION_AVATARS);
              const hiddenCount = count - visibleReactions.length;
              const names = reactions
                .map((reaction) => reaction.user.displayName)
                .join(", ");
              const animateTrigger =
                reactionAnimation?.emoji === emoji
                  ? reactionAnimation.trigger
                  : 0;

              return (
                <ReactionChip
                  key={`${emoji}:${animateTrigger}`}
                  emoji={emoji}
                  isMine={isMine}
                  animateTrigger={animateTrigger}
                  title={names || emoji}
                  onClick={() => onReaction?.(comment.id, emoji)}
                  disabled={!user || !onReaction}
                >
                  {visibleReactions.length > 0 && (
                    <span className="reaction-chip__avatars">
                      {visibleReactions.map((reaction, index) => (
                        <span
                          className="reaction-avatar-slot"
                          key={reaction.user?.id ?? index}
                          style={{ zIndex: visibleReactions.length - index }}
                        >
                          {reaction.user.avatarUrl ? (
                            <AvatarMedia
                              className="reaction-avatar"
                              src={getBrowserFileUrl(reaction.user.avatarUrl)}
                              alt=""
                            />
                          ) : (
                            <span className="reaction-avatar reaction-avatar-fallback">
                              {(reaction.user.displayName ?? "?")
                                .charAt(0)
                                .toUpperCase()}
                            </span>
                          )}
                        </span>
                      ))}
                      {hiddenCount > 0 && (
                        <span
                          className="reaction-avatar-slot reaction-avatar-more"
                          style={{ zIndex: 0 }}
                        >
                          +{hiddenCount}
                        </span>
                      )}
                    </span>
                  )}
                </ReactionChip>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  return user && onReaction ? (
    <ContextMenu onReaction={handleContextReaction}>
      {commentContent}
    </ContextMenu>
  ) : (
    commentContent
  );
}
