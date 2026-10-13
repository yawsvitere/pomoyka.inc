interface PostishkaUrlData {
  slug?: string | null;
  title?: string | null;
  text?: string | null;
}

export function getPostishkaUrl(
  post: PostishkaUrlData,
  publicOnly = false,
) {
  const path =
    post.slug?.trim() ||
    post.title?.trim() ||
    post.text?.trim().split("\n")[0] ||
    "postishka";
  return publicOnly ? `/posts/public/${path}` : `/posts/${path}`;
}
