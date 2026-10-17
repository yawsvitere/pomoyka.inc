import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { FeedBanner, Post, PostFile } from "../../api/types";
import type { FeedPoll } from "../../api/types";
import * as postsApi from "../../api/posts";
import { AppExternalLink, AppLink } from "../ui/AppLink";
import { AvatarMedia } from "../ui/AvatarMedia";
import { getBrowserFileUrl } from "../../utils/fileUrl";
import { getPostishkaUrl } from "../../utils/postishkaUrl";
import { PostishkaCoverImage } from "./PostishkaCoverImage";

interface FeedSidebarProps {
  posts: Post[];
  postishki: Post[];
  banners: FeedBanner[];
  polls: FeedPoll[];
  onPollUpdate: (poll: FeedPoll) => void;
}

function getPostLabel(post: Post) {
  return post.title?.trim() || post.text?.trim() || "Без текста";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

function getRecentFiles(posts: Post[]) {
  return posts
    .flatMap((post) => post.files.map((file) => ({ file, post })))
    .slice(0, 4);
}

function FileLink({ file, post }: { file: PostFile; post: Post }) {
  return (
    <AppExternalLink
      className="feed-sidebar-file"
      href={getBrowserFileUrl(file.downloadUrl)}
      title={file.fileName}
    >
      <span className="feed-sidebar-file-icon">↗</span>
      <span>
        <strong>{file.fileName}</strong>
        <small>{post.author.displayName}</small>
      </span>
    </AppExternalLink>
  );
}

function formatDeadline(value: string) {
  return `до ${new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))}`;
}

const MAX_VISIBLE_VOTERS = 3;

function PollCard({
  poll,
  onUpdate,
}: {
  poll: FeedPoll;
  onUpdate: (poll: FeedPoll) => void;
}) {
  const [selectionDraft, setSelectionDraft] = useState<{
    savedVotes: string;
    optionIds: string[];
  } | null>(null);
  const [newOption, setNewOption] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deadlineReached, setDeadlineReached] = useState(false);
  const savedVotes = poll.myOptionIds.join(",");
  const selectedOptionIds =
    selectionDraft?.savedVotes === savedVotes
      ? selectionDraft.optionIds
      : poll.myOptionIds;
  const hasVoted = poll.myOptionIds.length > 0;
  const isClosed = poll.isClosed || deadlineReached;

  useEffect(() => {
    let timer: number;
    const checkDeadline = () => {
      const remaining = new Date(poll.endsAt).getTime() - Date.now();
      if (remaining <= 0) {
        setDeadlineReached(true);
        return;
      }
      timer = window.setTimeout(checkDeadline, Math.min(remaining, 60_000));
    };
    timer = window.setTimeout(
      checkDeadline,
      Math.min(
        Math.max(0, new Date(poll.endsAt).getTime() - Date.now()),
        60_000,
      ),
    );
    return () => window.clearTimeout(timer);
  }, [poll.endsAt]);

  function toggleOption(optionId: string) {
    if (!poll.allowMultipleChoices) {
      setSelectionDraft({ savedVotes, optionIds: [optionId] });
      return;
    }
    setSelectionDraft({
      savedVotes,
      optionIds: selectedOptionIds.includes(optionId)
        ? selectedOptionIds.filter((id) => id !== optionId)
        : [...selectedOptionIds, optionId],
    });
  }

  async function submitVote(optionIds = selectedOptionIds) {
    try {
      setIsSubmitting(true);
      setError(null);
      const updatedPoll = await postsApi.voteFeedPoll(poll.id, optionIds);
      setSelectionDraft(null);
      onUpdate(updatedPoll);
    } catch (caught) {
      console.error("Error voting in feed poll:", caught);
      setError("Не удалось сохранить голос. Попробуйте ещё раз.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitOption(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newOption.trim()) return;
    try {
      setIsSubmitting(true);
      setError(null);
      const updatedPoll = await postsApi.addFeedPollOption(
        poll.id,
        newOption.trim(),
      );
      onUpdate(updatedPoll);
      setNewOption("");
    } catch (caught) {
      console.error("Error adding feed poll option:", caught);
      setError("Не удалось добавить вариант. Проверьте, что он ещё не добавлен.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const leadingVotes = Math.max(0, ...poll.options.map((o) => o.voteCount));
  const isChanged =
    selectedOptionIds.length !== poll.myOptionIds.length ||
    selectedOptionIds.some((id) => !poll.myOptionIds.includes(id));
  const showSubmit = selectedOptionIds.length > 0 && isChanged;

  return (
    <section
      className={`feed-sidebar-section feed-poll${isClosed ? " is-closed" : ""}`}
      aria-label="Голосование"
    >
      <div className="feed-sidebar-heading">
        <h2>Голосование</h2>
        <span>{poll.totalVotes}</span>
      </div>
      <h3 className="feed-poll-question">{poll.question}</h3>
      <p className="feed-poll-meta">
        {isClosed ? "Голосование завершено" : formatDeadline(poll.endsAt)}
        {poll.isAnonymous && <span> · анонимно</span>}
        {poll.allowMultipleChoices && <span> · несколько вариантов</span>}
      </p>

      <div className="feed-poll-options">
        {poll.options.map((option) => {
          const percentage = poll.totalVotes
            ? Math.round((option.voteCount / poll.totalVotes) * 100)
            : 0;
          const isSelected = isClosed
            ? poll.myOptionIds.includes(option.id)
            : selectedOptionIds.includes(option.id);
          const isLeading =
            option.voteCount > 0 && option.voteCount === leadingVotes;
          const visibleVoters = option.voters.slice(0, MAX_VISIBLE_VOTERS);
          const hiddenVoters = option.voters.length - visibleVoters.length;

          const votersNode =
            !poll.isAnonymous && option.voters.length > 0 ? (
              <span
                className="feed-poll-voters"
                aria-label={`Проголосовали за «${option.text}»`}
              >
                {visibleVoters.map((voter) => (
                  <span
                    className="feed-poll-voter"
                    key={voter.id}
                    title={voter.displayName}
                  >
                    {voter.avatarUrl ? (
                      <AvatarMedia
                        className="feed-poll-voter-avatar"
                        src={getBrowserFileUrl(voter.avatarUrl)}
                        alt={voter.displayName}
                      />
                    ) : (
                      <span
                        className="feed-poll-voter-avatar feed-poll-voter-fallback"
                        style={{ background: voter.nicknameColor }}
                      >
                        {voter.displayName.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </span>
                ))}
                {hiddenVoters > 0 && (
                  <span className="feed-poll-voter-more">+{hiddenVoters}</span>
                )}
              </span>
            ) : null;

          const rowBody = (
            <>
              {isClosed && isSelected && (
                <span className="feed-poll-mine" aria-label="Ваш голос">
                  ✓
                </span>
              )}
              <span className="feed-poll-text">{option.text}</span>
              {votersNode}
              <span className="feed-poll-score">
                <strong>{percentage}%</strong>
                <small>{option.voteCount}</small>
              </span>
            </>
          );

          return (
            <div
              className={`feed-poll-option${isSelected ? " is-selected" : ""}${isLeading ? " is-leading" : ""}`}
              key={option.id}
            >
              <span className="feed-poll-bar" aria-hidden="true">
                <span style={{ width: `${percentage}%` }} />
              </span>
              {isClosed ? (
                <div className="feed-poll-choice">{rowBody}</div>
              ) : (
                <label className="feed-poll-choice is-interactive">
                  <input
                    className="feed-poll-input"
                    type={poll.allowMultipleChoices ? "checkbox" : "radio"}
                    name={`poll-${poll.id}`}
                    checked={isSelected}
                    onChange={() => toggleOption(option.id)}
                    disabled={isSubmitting}
                  />
                  {(!hasVoted || isSelected) && (
                    <span
                      className={`feed-poll-mark${poll.allowMultipleChoices ? " is-multi" : ""}`}
                      aria-hidden="true"
                    />
                  )}
                  {rowBody}
                </label>
              )}
            </div>
          );
        })}
      </div>

      {!isClosed && (
        <>
          {showSubmit && (
            <div className="feed-poll-actions">
              <button
                className="btn btn-primary btn-sm feed-poll-submit"
                disabled={isSubmitting}
                onClick={() => void submitVote()}
              >
                {isSubmitting
                  ? "Сохраняю..."
                  : hasVoted
                    ? "Изменить голос"
                    : "Проголосовать"}
              </button>
            </div>
          )}
          {poll.allowUserOptions && (
            <form className="feed-poll-add-option" onSubmit={submitOption}>
              <input
                className="input"
                value={newOption}
                maxLength={120}
                placeholder="Предложить вариант"
                onChange={(event) => setNewOption(event.target.value)}
                disabled={isSubmitting}
              />
              <button
                className="btn btn-secondary btn-sm"
                type="submit"
                disabled={isSubmitting || !newOption.trim()}
                aria-label="Добавить вариант"
              >
                +
              </button>
            </form>
          )}
        </>
      )}

      {error && (
        <p className="feed-poll-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function FeedSidebar({
  posts,
  postishki,
  banners,
  polls,
  onPollUpdate,
}: FeedSidebarProps) {
  const recentPostishki = postishki.slice(0, 3);
  const recentFiles = getRecentFiles(posts);

  return (
    <aside className="feed-sidebar" aria-label="Обзор ленты">
      {banners.length > 0 && (
        <div className="feed-sidebar-banners" aria-label="Баннеры">
          {banners.map((banner) => (
            <AppLink
              className="feed-sidebar-banner"
              key={banner.id}
              to={getPostishkaUrl({
                slug: banner.postSlug,
              })}
            >
              <PostishkaCoverImage
                postId={banner.postId}
                hasOgCover={banner.hasOgCover}
                fallbackUrl={
                  banner.imageUrl
                    ? getBrowserFileUrl(banner.imageUrl)
                    : null
                }
              />
              <span className="feed-sidebar-banner-overlay">
                <strong>{banner.title}</strong>
                <small>{formatDate(banner.createdAt)}</small>
              </span>
            </AppLink>
          ))}
        </div>
      )}
      {polls.map((poll) => (
        <PollCard key={poll.id} poll={poll} onUpdate={onPollUpdate} />
      ))}
      <section className="feed-sidebar-section">
        <div className="feed-sidebar-heading">
          <h2>Последние постишки</h2>
          <span>{recentPostishki.length}</span>
        </div>
        {recentPostishki.length > 0 ? (
          <div className="feed-sidebar-posts">
            {recentPostishki.map((post) => (
              <AppLink
                className="feed-sidebar-post"
                key={post.id}
                to={getPostishkaUrl(post)}
              >
                <strong>{getPostLabel(post)}</strong>
                <span>
                  {post.author.displayName} · {formatDate(post.createdAt)}
                </span>
              </AppLink>
            ))}
          </div>
        ) : (
          <p className="feed-sidebar-empty">Пока ничего нет</p>
        )}
      </section>

      <section className="feed-sidebar-section">
        <div className="feed-sidebar-heading">
          <h2>Файлы</h2>
          <span>{recentFiles.length}</span>
        </div>
        {recentFiles.length > 0 ? (
          <div className="feed-sidebar-files">
            {recentFiles.map(({ file, post }) => (
              <FileLink file={file} post={post} key={file.id} />
            ))}
          </div>
        ) : (
          <p className="feed-sidebar-empty">Прикреплённых файлов нет</p>
        )}
      </section>
    </aside>
  );
}