-- V1: initial schema
CREATE TABLE author (
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    nationality VARCHAR(100)
);

CREATE TABLE book (
    id         BIGSERIAL PRIMARY KEY,
    title      VARCHAR(255) NOT NULL,
    price      NUMERIC(10, 2) NOT NULL,
    price_old  NUMERIC(10, 2),          -- deprecated, to be removed after migration
    stock      INTEGER NOT NULL DEFAULT 0,
    author_id  BIGINT REFERENCES author(id)
);

INSERT INTO author (name, nationality) VALUES
    ('Joshua Bloch', 'American'),
    ('Martin Fowler', 'British'),
    ('Robert C. Martin', 'American');

INSERT INTO book (title, price, price_old, stock, author_id) VALUES
    ('Effective Java',             45.00, 39.99, 100, 1),
    ('Refactoring',                42.00, 36.99,  80, 2),
    ('Clean Code',                 38.00, 32.99, 120, 3),
    ('Patterns of Enterprise App', 55.00, 49.99,  60, 2);
