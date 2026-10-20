-- Ensaio da publicação automática (prova 2, roteiro §3.4): falha DE PROPÓSITO
-- por um estado do banco (a prova 1 já gravou id = 1). Corrige-se apagando
-- a linha id = 1 de ensaio.publicacao_engage e dando Re-run na MESMA execução.
insert into ensaio.publicacao_engage (id, nota) values (1, 'prova 2');
