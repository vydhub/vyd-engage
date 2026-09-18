import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Popover, PopoverTrigger, PopoverContent } from '../popover';
import { Button } from '../button';

// Regressão FRG-156: Button sem React.forwardRef fazia o Radix Popper perder a
// âncora (React 18 recusa `ref` em função simples) e o painel ficava parado em
// `translate(0, -200%)`, fora da tela — nunca posicionado.
describe('Button dentro de Popover asChild (FRG-156)', () => {
  afterEach(() => {
    cleanup();
  });

  it('não emite o aviso de ref e posiciona o painel ao clicar no gatilho', async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <Popover>
        <PopoverTrigger asChild>
          <Button>Selecione a empresa</Button>
        </PopoverTrigger>
        <PopoverContent>Conteúdo do painel</PopoverContent>
      </Popover>
    );

    await user.click(screen.getByRole('button', { name: 'Selecione a empresa' }));

    const avisoDeRef = consoleError.mock.calls.some(
      (args) =>
        typeof args[0] === 'string' && args[0].includes('Function components cannot be given refs')
    );
    expect(avisoDeRef).toBe(false);

    const wrapper = document.querySelector<HTMLElement>('[data-radix-popper-content-wrapper]');
    expect(wrapper).not.toBeNull();
    expect(wrapper?.style.transform).not.toBe('translate(0, -200%)');

    consoleError.mockRestore();
  });
});
