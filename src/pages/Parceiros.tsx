import { Header } from '@/components/Header';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PainelTab } from '@/components/parceiros/PainelTab';
import { ConsultoresTab } from '@/components/parceiros/ConsultoresTab';
import { RegistrosTab } from '@/components/parceiros/RegistrosTab';
import { ConflitosTab } from '@/components/parceiros/ConflitosTab';
import { ComissoesTab } from '@/components/parceiros/ComissoesTab';
import { RelacionamentoTab } from '@/components/parceiros/RelacionamentoTab';
import { DocsConfigTab } from '@/components/parceiros/DocsConfigTab';

export function Parceiros() {
  return (
    <div className="min-h-screen">
      <Header
        title="Parceiros Comerciais"
        subtitle="Consultores externos, registro de oportunidades, conflitos, comissões e relacionamento."
      />
      <div className="px-4 md:px-8 py-6">
        <Tabs defaultValue="painel">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="painel">Painel</TabsTrigger>
            <TabsTrigger value="consultores">Consultores</TabsTrigger>
            <TabsTrigger value="registros">Registros</TabsTrigger>
            <TabsTrigger value="conflitos">Conflitos</TabsTrigger>
            <TabsTrigger value="comissoes">Comissões</TabsTrigger>
            <TabsTrigger value="relacionamento">Relacionamento</TabsTrigger>
            <TabsTrigger value="docsconfig">Docs & Config</TabsTrigger>
          </TabsList>
          <TabsContent value="painel" className="mt-4">
            <PainelTab />
          </TabsContent>
          <TabsContent value="consultores" className="mt-4">
            <ConsultoresTab />
          </TabsContent>
          <TabsContent value="registros" className="mt-4">
            <RegistrosTab />
          </TabsContent>
          <TabsContent value="conflitos" className="mt-4">
            <ConflitosTab />
          </TabsContent>
          <TabsContent value="comissoes" className="mt-4">
            <ComissoesTab />
          </TabsContent>
          <TabsContent value="relacionamento" className="mt-4">
            <RelacionamentoTab />
          </TabsContent>
          <TabsContent value="docsconfig" className="mt-4">
            <DocsConfigTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
