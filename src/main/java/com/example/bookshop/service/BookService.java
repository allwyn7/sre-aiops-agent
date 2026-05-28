package com.example.bookshop.service;

import com.example.bookshop.entity.Book;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import javax.persistence.EntityManager;
import javax.persistence.TypedQuery;
import java.util.List;

@Service
public class BookService {

    @Autowired
    private EntityManager entityManager;

    public List<Book> findAllBooksWithAuthors() {
        // Refactored to perform a single JOIN query
        String jpql = "SELECT b FROM Book b JOIN FETCH b.author";
        TypedQuery<Book> query = entityManager.createQuery(jpql, Book.class);
        return query.getResultList();
    }
}
