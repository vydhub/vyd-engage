-- Ensaio da publicação automática (prova 1, roteiro §3.4): migration aditiva.
create schema if not exists ensaio;

create table ensaio.publicacao_engage (
  id integer primary key,
  nota text not null,
  coluna_ensaio text
);

insert into ensaio.publicacao_engage (id, nota) values (1, 'prova 1');
