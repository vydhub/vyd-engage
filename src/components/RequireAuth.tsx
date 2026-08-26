import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../contexts/AuthContext';
import { Loader2 } from 'lucide-react';

interface RequireAuthProps {
  children: ReactNode;
  /** Papéis permitidos. Vazio/ausente = qualquer autenticado. Platform-admin sempre passa. */
  requiredRoles?: string[];
}

export function RequireAuth({ children, requiredRoles }: RequireAuthProps) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 size={32} className="animate-spin text-blue-600" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // CONSULTOR (parceiro externo) vive EXCLUSIVAMENTE no Portal do Parceiro —
  // qualquer rota fora de /portal redireciona p/ lá (o backend também bloqueia:
  // gate fail-closed no authenticate). Evita loop: /portal nunca redireciona.
  if (user.role === 'CONSULTOR' && !location.pathname.startsWith('/portal')) {
    return <Navigate to="/portal" replace />;
  }

  // Gating por papel (spec papeis-comerciais): quem não tem o papel exigido é
  // redirecionado ao dashboard. A API também bloqueia (defesa em profundidade).
  if (
    requiredRoles &&
    requiredRoles.length > 0 &&
    !user.isPlatformAdmin &&
    !requiredRoles.includes(user.role)
  ) {
    return <Navigate to="/app" replace />;
  }

  return <>{children}</>;
}
