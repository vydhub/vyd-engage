// PORTAL do Parceiro — documentos/templates publicados pela empresa (req 35).
// Dados via usePortalDocumentos(); download abre a URL autenticada do apiClient
// em nova aba (exceção autorizada ao padrão "dados só via hooks").

import { Download, FileText, FileWarning } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { usePortalDocumentos } from '@/hooks/usePortalParceiro';
import { apiClient } from '@/services/api/client';
import type { ConsultorDocumento } from '@/types/parceiros';

function formatarData(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pt-BR');
}

export function PortalDocumentos() {
  const { data: documentos, isLoading, isError } = usePortalDocumentos();

  const handleBaixar = (doc: ConsultorDocumento) => {
    window.open(apiClient.portalDocumentoDownloadUrl(doc.id), '_blank', 'noopener,noreferrer');
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center rounded-md border border-border bg-card px-4 py-12 text-center">
        <FileWarning className="mb-3 text-destructive" size={32} />
        <p className="font-medium text-foreground">Erro ao carregar os documentos</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Não foi possível buscar os documentos. Tente novamente.
        </p>
      </div>
    );
  }

  const lista = documentos ?? [];

  if (lista.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-md border border-border bg-card px-4 py-12 text-center">
        <FileText className="mb-3 text-muted-foreground" size={32} />
        <p className="font-medium text-foreground">Nenhum documento disponível no momento.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Quando a empresa publicar materiais e templates, eles aparecerão aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {lista.map((doc) => (
        <Card key={doc.id}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-start gap-2 text-base text-foreground">
              <FileText size={18} className="mt-0.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 break-words">{doc.titulo}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Publicado em {formatarData(doc.createdAt)}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => handleBaixar(doc)}
            >
              <Download size={14} />
              Baixar
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
