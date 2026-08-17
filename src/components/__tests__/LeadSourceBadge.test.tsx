import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LeadSourceBadge } from '../LeadSourceBadge';

// Régua nova (specs/leads-oportunidade req. 8), com compat para valores legados.
describe('LeadSourceBadge', () => {
  it('should render "Prospecção ativa" for source "PROSPECCAO_ATIVA"', () => {
    render(<LeadSourceBadge source="PROSPECCAO_ATIVA" />);
    expect(screen.getByText('Prospecção ativa')).toBeInTheDocument();
  });

  it('should render "Portal de Notícias/LinkedIn" for source "PORTAL_NOTICIAS_LINKEDIN"', () => {
    render(<LeadSourceBadge source="PORTAL_NOTICIAS_LINKEDIN" />);
    expect(screen.getByText('Portal de Notícias/LinkedIn')).toBeInTheDocument();
  });

  it('should render "Evento/Feira setorial" for source "EVENTO_FEIRA_SETORIAL"', () => {
    render(<LeadSourceBadge source="EVENTO_FEIRA_SETORIAL" />);
    expect(screen.getByText('Evento/Feira setorial')).toBeInTheDocument();
  });

  it('should render "Networking pessoal" for source "NETWORKING_PESSOAL"', () => {
    render(<LeadSourceBadge source="NETWORKING_PESSOAL" />);
    expect(screen.getByText('Networking pessoal')).toBeInTheDocument();
  });

  it('should render "Cliente recorrente" for source "CLIENTE_RECORRENTE"', () => {
    render(<LeadSourceBadge source="CLIENTE_RECORRENTE" />);
    expect(screen.getByText('Cliente recorrente')).toBeInTheDocument();
  });

  it('should render "Indicação de parceiros" for source "INDICACAO_PARCEIROS"', () => {
    render(<LeadSourceBadge source="INDICACAO_PARCEIROS" />);
    expect(screen.getByText('Indicação de parceiros')).toBeInTheDocument();
  });

  it('should render "Outros" for source "OUTROS"', () => {
    render(<LeadSourceBadge source="OUTROS" />);
    expect(screen.getByText('Outros')).toBeInTheDocument();
  });

  it('should render an icon alongside the label', () => {
    const { container } = render(<LeadSourceBadge source="PROSPECCAO_ATIVA" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  // Compat: valores legados do enum antigo traduzidos (mesmo mapa da migração)
  it('should map legacy "WEBSITE" to "Outros"', () => {
    render(<LeadSourceBadge source="WEBSITE" />);
    expect(screen.getByText('Outros')).toBeInTheDocument();
  });

  it('should map legacy "SOCIAL_MEDIA" to "Portal de Notícias/LinkedIn"', () => {
    render(<LeadSourceBadge source="SOCIAL_MEDIA" />);
    expect(screen.getByText('Portal de Notícias/LinkedIn')).toBeInTheDocument();
  });

  it('should map legacy "REFERRAL" to "Indicação de parceiros"', () => {
    render(<LeadSourceBadge source="REFERRAL" />);
    expect(screen.getByText('Indicação de parceiros')).toBeInTheDocument();
  });

  it('should map legacy lowercase "other" to "Outros" without crashing', () => {
    expect(() => render(<LeadSourceBadge source="other" />)).not.toThrow();
    expect(screen.getByText('Outros')).toBeInTheDocument();
  });

  it('should fall back to a generic badge for unknown sources', () => {
    expect(() => render(<LeadSourceBadge source="qualquer_coisa" />)).not.toThrow();
    const { container } = render(<LeadSourceBadge source="qualquer_coisa" />);
    const badge = container.querySelector('span');
    expect(badge).toBeInTheDocument();
  });
});
