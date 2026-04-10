package com.sap.demo.bookshop.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;

@Entity
@Table(name = "book")
public class Book {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String title;

    @Column(nullable = false)
    private BigDecimal price;

    // ⚠️ INCIDENT SCENARIO: PR #52 removes this field but no Flyway migration drops the column.
    // Hibernate still generates SELECT ... price_old ... causing PSQLException.
    // To simulate the incident, delete this field and redeploy WITHOUT adding V2 migration.
    @Column(name = "price_old")
    private BigDecimal priceOld;

    @Column(nullable = false)
    private Integer stock;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "author_id")
    private Author author;

    // Getters and setters
    public Long getId()                  { return id; }
    public void setId(Long id)           { this.id = id; }

    public String getTitle()             { return title; }
    public void setTitle(String title)   { this.title = title; }

    public BigDecimal getPrice()                { return price; }
    public void setPrice(BigDecimal price)      { this.price = price; }

    public BigDecimal getPriceOld()             { return priceOld; }
    public void setPriceOld(BigDecimal p)       { this.priceOld = p; }

    public Integer getStock()                   { return stock; }
    public void setStock(Integer stock)         { this.stock = stock; }

    public Author getAuthor()                   { return author; }
    public void setAuthor(Author author)        { this.author = author; }
}
