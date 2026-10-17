-- Personagem do jogo escolhido pelo profissional (Estrelas). Só acrescenta uma coluna que aceita vazio.
ALTER TABLE users ADD COLUMN game_character VARCHAR(40) NULL;
