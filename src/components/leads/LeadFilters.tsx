import { useNavigate } from 'react-router';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Plus, Upload, Copy } from 'lucide-react';
import { FilterPopover } from './FilterPopover';
import { ExportButton } from '../ExportButton';
import {
  LEAD_STATUS_LABELS,
  LEAD_SOURCE_LABELS,
  type LeadStatus,
  type LeadSource,
} from '../../types';

// Régua nova da área comercial (specs/leads-oportunidade reqs. 12, 23-24): os
// filtros usam os enums novos DIRETO (sem mapeamento leadEnums) e os filtros de
// tag, automações (mock) e campos customizados saíram da tela.
const STATUS_OPTIONS = (Object.entries(LEAD_STATUS_LABELS) as Array<[LeadStatus, string]>).map(
  ([value, label]) => ({ value, label })
);

const SOURCE_OPTIONS = (Object.entries(LEAD_SOURCE_LABELS) as Array<[LeadSource, string]>).map(
  ([value, label]) => ({ value, label })
);

interface LeadFiltersProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  filterStatus: string[];
  onFilterStatusChange: (status: string[]) => void;
  filterSource: string[];
  onFilterSourceChange: (source: string[]) => void;
  onImportClick: () => void;
  onExportAllFiltered: () => void;
  onExportServer?: (format: 'json' | 'csv' | 'xlsx') => Promise<Blob>;
}

export function LeadFilters({
  searchQuery,
  onSearchChange,
  filterStatus,
  onFilterStatusChange,
  filterSource,
  onFilterSourceChange,
  onImportClick,
  onExportAllFiltered,
  onExportServer,
}: LeadFiltersProps) {
  const navigate = useNavigate();

  return (
    <div className="bg-card rounded-lg p-3 md:p-4 shadow-sm border border-gray-300 mb-4 md:mb-6">
      <div className="flex flex-wrap items-center gap-2 md:gap-4">
        <div className="flex-1 min-w-[160px] md:min-w-[200px] w-full md:w-auto">
          <Input
            placeholder="Buscar por nome..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Buscar leads por nome"
          />
        </div>

        <FilterPopover
          filterId="status"
          label="Filtrar por Status"
          allLabel="Todos os status"
          countSuffix="status"
          options={STATUS_OPTIONS}
          selected={filterStatus}
          onChange={onFilterStatusChange}
        />

        <FilterPopover
          filterId="source"
          label="Filtrar por Origem"
          allLabel="Todas as origens"
          countSuffix="origem(s)"
          options={SOURCE_OPTIONS}
          selected={filterSource}
          onChange={onFilterSourceChange}
        />

        <Button
          variant="outline"
          className="gap-2"
          onClick={() => navigate('/app/leads/duplicates')}
        >
          <Copy size={16} />
          Duplicados
        </Button>

        <Button variant="outline" className="gap-2" onClick={onImportClick}>
          <Upload size={16} />
          Importar
        </Button>

        {onExportServer ? (
          <ExportButton onExport={onExportServer} filename="leads-export" label="Exportar" />
        ) : (
          <ExportButton
            onExport={async () => {
              onExportAllFiltered();
              return new Blob(); // fallback — legacy handler manages download
            }}
            filename="leads-export"
            label="Exportar"
          />
        )}

        <Button
          className="bg-primary hover:bg-primary-dark gap-2"
          onClick={() => navigate('/app/leads/new')}
          data-tour="create-lead-btn"
        >
          <Plus size={16} />
          Novo Lead
        </Button>
      </div>
    </div>
  );
}
