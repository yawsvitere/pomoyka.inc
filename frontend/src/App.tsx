import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";

import { AuthProvider, useAuth } from "./context/AuthContext";
import { ErrorPage } from "./components/ui/ErrorPage";

const LoginPage = lazy(() =>
  import("./pages/LoginPage").then(({ LoginPage }) => ({ default: LoginPage })),
);
const CodePage = lazy(() =>
  import("./pages/CodePage").then(({ CodePage }) => ({ default: CodePage })),
);
const RegisterPage = lazy(() =>
  import("./pages/RegisterPage").then(({ RegisterPage }) => ({
    default: RegisterPage,
  })),
);
const FeedPage = lazy(() =>
  import("./pages/FeedPage").then(({ FeedPage }) => ({ default: FeedPage })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then(({ SettingsPage }) => ({
    default: SettingsPage,
  })),
);
const AdminPage = lazy(() =>
  import("./pages/AdminPage").then(({ AdminPage }) => ({ default: AdminPage })),
);
const ProfilePage = lazy(() =>
  import("./pages/ProfilePage").then(({ ProfilePage }) => ({
    default: ProfilePage,
  })),
);
const CreatePostPage = lazy(() =>
  import("./pages/CreatePostPage").then(({ CreatePostPage }) => ({
    default: CreatePostPage,
  })),
);
const EditPostishkaPage = lazy(() =>
  import("./pages/EditPostishkaPage").then(({ EditPostishkaPage }) => ({
    default: EditPostishkaPage,
  })),
);
const PostishkiPage = lazy(() =>
  import("./pages/PostishkiPage").then(({ PostishkiPage }) => ({
    default: PostishkiPage,
  })),
);
const ArticlePage = lazy(() =>
  import("./pages/ArticlePage").then(({ ArticlePage }) => ({
    default: ArticlePage,
  })),
);
const ArchiveCalendarPage = lazy(() =>
  import("./pages/ArchiveCalendarPage").then(({ ArchiveCalendarPage }) => ({
    default: ArchiveCalendarPage,
  })),
);
const ArchivePage = lazy(() =>
  import("./pages/ArchivePage").then(({ ArchivePage }) => ({
    default: ArchivePage,
  })),
);
const FileManagerPage = lazy(() =>
  import("./pages/FileManagerPage").then(({ FileManagerPage }) => ({
    default: FileManagerPage,
  })),
);
const CommonFilesPage = lazy(() =>
  import("./pages/CommonFilesPage").then(({ CommonFilesPage }) => ({
    default: CommonFilesPage,
  })),
);
const FileGalleryPage = lazy(() =>
  import("./pages/FileGalleryPage").then(({ FileGalleryPage }) => ({
    default: FileGalleryPage,
  })),
);
const FileSharePage = lazy(() =>
  import("./pages/FileSharePage").then(({ FileSharePage }) => ({
    default: FileSharePage,
  })),
);
const PinterestPage = lazy(() =>
  import("./pages/PinterestPage").then(({ PinterestPage }) => ({
    default: PinterestPage,
  })),
);
const PrivateLayout = lazy(() =>
  import("./components/layout/PrivateLayout").then(({ PrivateLayout }) => ({
    default: PrivateLayout,
  })),
);

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return null;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function isAdmin() {
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

function AdminRoute({ children }: { children: React.ReactNode }) {
  return isAdmin() ? <>{children}</> : <ErrorPage status={500} />;
}

function GuestRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return null;
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route
          path="/login"
          element={
            <GuestRoute>
              <LoginPage />
            </GuestRoute>
          }
        />

        <Route
          path="/register/code"
          element={
            <GuestRoute>
              <CodePage />
            </GuestRoute>
          }
        />

        <Route
          path="/register"
          element={
            <GuestRoute>
              <RegisterPage />
            </GuestRoute>
          }
        />

        <Route
          path="/"
          element={
            <PrivateRoute>
              <PrivateLayout>
                <FeedPage />
              </PrivateLayout>
            </PrivateRoute>
          }
        />

        <Route
          path="/settings"
          element={
            <PrivateRoute>
              <PrivateLayout>
                <SettingsPage />
              </PrivateLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <PrivateRoute>
              <AdminRoute>
                <PrivateLayout>
                  <AdminPage />
                </PrivateLayout>
              </AdminRoute>
            </PrivateRoute>
          }
        />
        <Route
          path="/profile/:userId"
          element={
            <PrivateRoute>
              <PrivateLayout>
                <ProfilePage />
              </PrivateLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/posts/new"
          element={
            <PrivateRoute>
              <PrivateLayout>
                <CreatePostPage />
              </PrivateLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/posts"
          element={
            <PrivateRoute>
              <PrivateLayout>
                <PostishkiPage />
              </PrivateLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/posts/public/:postId"
          element={<ArticlePage publicOnly />}
        />
        <Route
          path="/posts/:postId"
          element={
            <PrivateRoute>
              <PrivateLayout>
                <ArticlePage />
              </PrivateLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/posts/:postId/edit"
          element={
            <PrivateRoute>
              <PrivateLayout>
                <EditPostishkaPage />
              </PrivateLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/archive"
          element={
            <PrivateRoute>
              <PrivateLayout>
                <ArchiveCalendarPage />
              </PrivateLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/archive/:year/:month/:day"
          element={
            <PrivateRoute>
              <PrivateLayout>
                <ArchivePage />
              </PrivateLayout>
            </PrivateRoute>
          }
        />
        <Route path="/files/gallery/:folderId" element={<FileGalleryPage />} />
        <Route path="/files/file/:fileId" element={<FileSharePage />} />
        <Route
          path="/files"
          element={
            <PrivateRoute>
              <PrivateLayout>
                <FileManagerPage />
              </PrivateLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/files/common"
          element={
            <PrivateRoute>
              <PrivateLayout>
                <CommonFilesPage />
              </PrivateLayout>
            </PrivateRoute>
          }
        />
        <Route
          path="/pinterest"
          element={
            <PrivateRoute>
              <PrivateLayout>
                <PinterestPage />
              </PrivateLayout>
            </PrivateRoute>
          }
        />

        <Route path="*" element={<ErrorPage status={404} />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  useEffect(() => {
    const preventAltWheel = (event: WheelEvent) => {
      if (event.altKey) event.preventDefault();
    };

    window.addEventListener("wheel", preventAltWheel, {
      capture: true,
      passive: false,
    });
    return () =>
      window.removeEventListener("wheel", preventAltWheel, { capture: true });
  }, []);

  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
