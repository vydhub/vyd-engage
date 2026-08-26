// Portal do Parceiro — shell próprio (coluna única, sem o AppShell/ribbon interno).
// O consultor externo só vê o que é dele; sem NDA assinado, só a tela de pendência.

import { LogOut, Handshake, FileSignature, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { usePortalPerfil } from '@/hooks/usePortalParceiro';
import { PortalOportunidades } from '@/components/parceiros/PortalOportunidades';
import { PortalComissoes } from '@/components/parceiros/PortalComissoes';
import { PortalMetasReunioes } from '@/components/parceiros/PortalMetasReunioes';
import { PortalDocumentos } from '@/components/parceiros/PortalDocumentos';

const FAIXA_LABEL: Record<string, string> = {
  SAUDAVEL: 'Saudável',
  ATENCAO: 'Atenção',
  ESFRIANDO: 'Esfriando',
  FRIO: 'Frio',
};

export function PortalParceiro() {
  const { user, logout } = useAuth();
  const perfil = usePortalPerfil();

  const ndaPendente = perfil.data && perfil.data.ndaStatus !== 'ASSINADO';

  return (
    <div className="bg-background text-foreground min-h-screen">
      {/* Topbar própria do portal (coluna única, sem ribbon interno) */}
      <header className="border-border bg-card flex items-center justify-between border-b px-4 py-3 md:px-8">
        <div className="flex items-center gap-2">
          <Handshake size={20} className="text-primary" />
          <div>
            <p className="text-sm font-semibold leading-tight">Portal do Parceiro</p>
            <p className="text-muted-foreground text-xs leading-tight">VYD Engage</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm leading-tight">{perfil.data?.nome ?? user?.name}</p>
            {perfil.data?.scoreFaixa && (
              <p className="text-muted-foreground text-xs leading-tight">
                Relacionamento: {FAIXA_LABEL[perfil.data.scoreFaixa] ?? perfil.data.scoreFaixa}
              </p>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => logout()}>
            <LogOut size={14} className="mr-1" />
            Sair
          </Button>
        </div>
      </header>

      <main className="px-4 py-6 md:px-8">
        {perfil.isLoading ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-16">
            <Loader2 size={18} className="animate-spin" /> Carregando…
          </div>
        ) : perfil.isError ? (
          <div className="border-border bg-card mx-auto max-w-lg rounded-md border p-6 text-center">
            <p className="font-medium">Não foi possível carregar seu perfil</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Sua conta pode estar suspensa. Fale com o gestor da parceria.
            </p>
          </div>
        ) : ndaPendente ? (
          // NDA gate (req 3): nada além desta tela até o NDA ser assinado.
          <div className="border-border bg-card mx-auto max-w-lg rounded-md border p-8 text-center">
            <FileSignature size={40} className="text-muted-foreground mx-auto mb-4" />
            <h2 className="text-lg font-semibold">Assinatura do NDA pendente</h2>
            <p className="text-muted-foreground mt-2 text-sm">
              Para acessar o portal, é necessário assinar o acordo de confidencialidade (NDA).
              {perfil.data?.ndaStatus === 'ENVIADO'
                ? ' Você recebeu um e-mail com o link de assinatura eletrônica — verifique sua caixa de entrada.'
                : ' Fale com o gestor da parceria para receber o documento.'}
            </p>
            <Badge variant="outline" className="mt-4">
              Status: {perfil.data?.ndaStatus === 'ENVIADO' ? 'Aguardando assinatura' : 'Pendente'}
            </Badge>
          </div>
        ) : (
          <Tabs defaultValue="oportunidades">
            <TabsList className="h-auto flex-wrap">
              <TabsTrigger value="oportunidades">Minhas Oportunidades</TabsTrigger>
              <TabsTrigger value="comissoes">Comissões</TabsTrigger>
              <TabsTrigger value="metas">Metas & Reuniões</TabsTrigger>
              <TabsTrigger value="documentos">Documentos</TabsTrigger>
            </TabsList>
            <TabsContent value="oportunidades" className="mt-4">
              <PortalOportunidades />
            </TabsContent>
            <TabsContent value="comissoes" className="mt-4">
              <PortalComissoes />
            </TabsContent>
            <TabsContent value="metas" className="mt-4">
              <PortalMetasReunioes />
            </TabsContent>
            <TabsContent value="documentos" className="mt-4">
              <PortalDocumentos />
            </TabsContent>
          </Tabs>
        )}
      </main>
    </div>
  );
}
