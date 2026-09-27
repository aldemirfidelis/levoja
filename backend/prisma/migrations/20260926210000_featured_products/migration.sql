-- Produto em destaque na vitrine da tela inicial do app.
-- AlterTable
ALTER TABLE "products" ADD COLUMN     "isFeatured" BOOLEAN NOT NULL DEFAULT false;
