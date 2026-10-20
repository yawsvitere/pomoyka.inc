export function isCurrentUserAdmin() {
  const token = localStorage.getItem("token");
  if (!token) return false;

  try {
    const payload = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    const roleClaim =
      payload.role ??
      payload["http://schemas.microsoft.com/ws/2008/06/identity/claims/role"];
    return (Array.isArray(roleClaim) ? roleClaim : [roleClaim]).includes(
      "Admin",
    );
  } catch {
    return false;
  }
}
