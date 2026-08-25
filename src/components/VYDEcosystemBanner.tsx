import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from 'react-router';

export function VYDEcosystemBanner() {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Define public routes where banner should ALWAYS appear
  const publicRoutes = [
    '/',
    '/login',
    '/onboarding',
    '/verify-email',
    '/accept-invitation',
  ];
  const isPublicRoute =
    publicRoutes.includes(location.pathname) || location.pathname.startsWith('/capture/');

  // Hide banner only if:
  // 1. We're on a private route (starts with /app)
  // 2. AND user is authenticated (not loading and has user.id)
  // Otherwise, show banner (public routes always show, unauthenticated /app routes show)
  if (!isPublicRoute && location.pathname.startsWith('/app') && !loading && user && user.id) {
    return null;
  }

  return (
    <div className="sticky top-0 left-0 right-0 z-[100] h-10 flex items-center px-6 bg-gray-50 border-b border-gray-200 shadow-sm">
      <div className="max-w-7xl mx-auto flex items-center justify-between text-sm w-full">
        <a
          href="https://www.vydhub.com"
          target="_self"
          className="inline-flex items-center gap-1.5 text-gray-600 hover:text-gray-900 transition-colors flex-shrink-0"
        >
          <ArrowLeft size={14} />
          <span>Back to VYD Hub</span>
        </a>
        <span className="text-gray-600 flex-shrink-0 ml-auto">A VYD ecosystem solution</span>
      </div>
    </div>
  );
}
