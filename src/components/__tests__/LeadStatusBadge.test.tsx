import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LeadStatusBadge } from '../LeadStatusBadge';

// Régua nova (specs/leads-oportunidade req. 7): NOVO/EM_ANDAMENTO/PAUSADO/
// CANCELADO/ENCERRADO, com compat para os valores legados pré-migração.
describe('LeadStatusBadge', () => {
  it('should render "Novo" for status "NOVO"', () => {
    render(<LeadStatusBadge status="NOVO" />);
    expect(screen.getByText('Novo')).toBeInTheDocument();
  });

  it('should render "Em Andamento" for status "EM_ANDAMENTO"', () => {
    render(<LeadStatusBadge status="EM_ANDAMENTO" />);
    expect(screen.getByText('Em Andamento')).toBeInTheDocument();
  });

  it('should render "Pausado" for status "PAUSADO"', () => {
    render(<LeadStatusBadge status="PAUSADO" />);
    expect(screen.getByText('Pausado')).toBeInTheDocument();
  });

  it('should render "Cancelado" for status "CANCELADO"', () => {
    render(<LeadStatusBadge status="CANCELADO" />);
    expect(screen.getByText('Cancelado')).toBeInTheDocument();
  });

  it('should render "Encerrado" for status "ENCERRADO"', () => {
    render(<LeadStatusBadge status="ENCERRADO" />);
    expect(screen.getByText('Encerrado')).toBeInTheDocument();
  });

  // Compat: valores legados (pré-migração) traduzidos para a régua nova
  it('should map legacy "NEW" to "Novo"', () => {
    render(<LeadStatusBadge status="NEW" />);
    expect(screen.getByText('Novo')).toBeInTheDocument();
  });

  it('should map legacy "QUALIFIED" to "Em Andamento"', () => {
    render(<LeadStatusBadge status="QUALIFIED" />);
    expect(screen.getByText('Em Andamento')).toBeInTheDocument();
  });

  it('should map legacy "WON" to "Encerrado"', () => {
    render(<LeadStatusBadge status="WON" />);
    expect(screen.getByText('Encerrado')).toBeInTheDocument();
  });

  it('should map legacy "LOST" to "Cancelado"', () => {
    render(<LeadStatusBadge status="LOST" />);
    expect(screen.getByText('Cancelado')).toBeInTheDocument();
  });

  it('should map legacy UI value "fechado" to "Encerrado"', () => {
    render(<LeadStatusBadge status="fechado" />);
    expect(screen.getByText('Encerrado')).toBeInTheDocument();
  });

  it('should fallback to raw status for unknown values', () => {
    render(<LeadStatusBadge status="CustomStatus" />);
    expect(screen.getByText('CustomStatus')).toBeInTheDocument();
  });

  it('should apply correct CSS classes for known statuses', () => {
    const { container } = render(<LeadStatusBadge status="NOVO" />);
    const badge = container.querySelector('span');
    expect(badge?.className).toContain('badge-status-novo');
  });
});
