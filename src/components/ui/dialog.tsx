'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog@1.1.6';
import { XIcon } from 'lucide-react@0.487.0';

import { cn } from './utils';

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/70',
        className
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        // `max-h` + `overflow-y-auto` são DEFAULT de propósito (não remover): o
        // conteúdo é `fixed` centrado por translate, então sem limite de altura ele
        // cresce para os dois lados e sai da tela SEM barra de rolagem — o body está
        // travado pelo Radix. Simetria com o `max-w-[calc(100%-2rem)]` ao lado.
        // Usos que fazem header/rodapé fixo + corpo rolável passam `overflow-hidden`
        // (e/ou `max-h-*` próprio) e o twMerge dá a vitória a eles.
        // `overflow-x-hidden` é explícito: pela spec, com um eixo != visible o outro
        // computa para `auto`, o que traria uma barra HORIZONTAL indesejada.
        // LIMITAÇÃO CONHECIDA: quando o modal de fato rola, o X abaixo (`absolute`)
        // rola junto e sai de vista — Esc e clique no overlay seguem fechando. Para
        // modais longos, prefira o padrão de cabeçalho fixo + corpo rolável
        // (`overflow-hidden` + `flex-1 overflow-y-auto min-h-0`), como o LeadModal.
        //
        // LARGURA: o default fica numa CUSTOM PROPERTY, não em `sm:max-w-*`.
        // Motivo: `sm:max-w-[32rem]` e um `max-w-2xl` vindo do uso são grupos
        // DIFERENTES para o tailwind-merge (variante `sm:` vs base), então os dois
        // sobreviviam ao merge e o `sm:` — mais específico — vencia. 18 modais
        // pediam largura maior e ficavam presos em 32rem; no gerenciador de
        // modelos isso empurrava os botões de ação para fora da área visível.
        // Com `max-w-[var(...)]`, qualquer `max-w-*` do uso conflita de verdade e
        // vence, e quem não passa nada continua com os mesmos 32rem de antes.
        style={{ ['--vyd-dialog-w' as string]: '32rem', ...props.style }}
        className={cn(
          'bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[min(calc(100%-2rem),var(--vyd-dialog-w))] max-h-[calc(100dvh-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 overflow-x-hidden overflow-y-auto rounded-lg border p-6 shadow-lg duration-200',
          className
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4">
          <XIcon />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-2 text-center sm:text-left', className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-lg leading-none font-semibold', className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
