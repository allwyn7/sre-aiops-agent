package com.sap.demo.bookshop.service;

import com.sap.demo.bookshop.entity.Book;
import com.sap.demo.bookshop.repository.BookRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;

@Service
@Transactional(readOnly = true)
public class BookService {

    private final BookRepository bookRepository;

    public BookService(BookRepository bookRepository) {
        this.bookRepository = bookRepository;
    }

    public List<Book> findAll() {
        return bookRepository.findAll();   // line 42 — appears in stack trace
    }

    public Book findById(Long id) {
        return bookRepository.findById(id)
            .orElseThrow(() -> new jakarta.persistence.EntityNotFoundException("Book not found: " + id));
    }

    public List<Book> search(String query) {
        return bookRepository.searchByTitle(query);
    }
}
