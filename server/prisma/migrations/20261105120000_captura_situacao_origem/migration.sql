-- Situação no portal do cliente (spec captura-demandas, filha 08, W-39).
--
-- Só acrescenta duas colunas anuláveis, sem valor padrão, em "Demanda": a situação do item no
-- portal e desde quando. Nada do site ou do serviço antigos lê ou depende delas.

-- AlterTable
ALTER TABLE "Demanda" ADD COLUMN     "situacaoOrigem" TEXT,
ADD COLUMN     "situacaoOrigemEm" TIMESTAMP(3);
