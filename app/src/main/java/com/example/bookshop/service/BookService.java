package com.example.bookshop.service;

import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

@Service
public class BookService {

    // Cache with maximum size of 100 entries and LRU eviction policy
    private static final int MAX_CACHE_SIZE = 100;
    private static final Map<String, Book> bookCache = 
            new LinkedHashMap<String, Book>(MAX_CACHE_SIZE, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, Book> eldest) {
                    return size() > MAX_CACHE_SIZE;
                }
            };

    public Optional<Book> getBookById(String id) {
        // First check if the book is in the cache
        if (bookCache.containsKey(id)) {
            return Optional.of(bookCache.get(id));
        }

        // If not in cache, fetch from DB (sample code)
        Optional<Book> book = fetchBookFromDatabase(id);

        // Store in the cache if found
        book.ifPresent(b -> bookCache.put(id, b));

        return book;
    }

    private Optional<Book> fetchBookFromDatabase(String id) {
        // Simulate database call
        return Optional.empty();
    }

}
