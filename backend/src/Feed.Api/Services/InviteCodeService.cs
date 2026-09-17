using System.Security.Cryptography;
using System.Text;
using Feed.Api.Data;
using Feed.Api.Models;
using Microsoft.EntityFrameworkCore;

namespace Feed.Api.Services;

public class InviteCodeService
{
    private readonly AppDbContext _db;

    public InviteCodeService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<InviteCode> CreateAsync(
        Guid createdById,
        string name,
        TimeSpan? lifetime = null)
    {
        var code = GenerateCode();

        var invite = new InviteCode
        {
            CodeHash = Hash(code),
            Code = code,
            Name = name.Trim(),
            CreatedById = createdById,
            ExpiresAt = lifetime.HasValue
                ? DateTime.UtcNow.Add(lifetime.Value)
                : null
        };

        _db.InviteCodes.Add(invite);
        await _db.SaveChangesAsync();

        return invite;
    }

    public async Task<InviteCode?> FindValidAsync(string code)
    {
        var hash = Hash(code);

        var invite = await _db.InviteCodes
            .FirstOrDefaultAsync(x => x.CodeHash == hash);

        if (invite == null)
            return null;

        if (invite.UsedAt != null)
            return null;

        if (invite.ExpiresAt.HasValue &&
            invite.ExpiresAt.Value <= DateTime.UtcNow)
            return null;

        return invite;
    }

    public async Task MarkUsedAsync(
        InviteCode invite,
        Guid userId)
    {
        invite.UsedAt = DateTime.UtcNow;
        invite.UsedById = userId;

        await _db.SaveChangesAsync();
    }

    public Task<List<InviteCode>> GetAllAsync() =>
        _db.InviteCodes.OrderByDescending(x => x.CreatedAt).ToListAsync();

    public async Task<bool> DeleteAsync(Guid id)
    {
        var invite = await _db.InviteCodes.FirstOrDefaultAsync(x => x.Id == id);
        if (invite == null) return false;
        _db.InviteCodes.Remove(invite);
        await _db.SaveChangesAsync();
        return true;
    }

    private static string GenerateCode()
    {
        var bytes = RandomNumberGenerator.GetBytes(9);

        var code = Convert
            .ToHexString(bytes)
            .ToUpperInvariant();

        return $"{code[..4]}-{code[4..8]}-{code[8..12]}";
    }

    private static string Hash(string value)
    {
        var bytes = SHA256.HashData(
            Encoding.UTF8.GetBytes(value)
        );

        return Convert.ToHexString(bytes);
    }
}